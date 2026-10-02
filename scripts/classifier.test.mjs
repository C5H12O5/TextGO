import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import * as tf from '@tensorflow/tfjs';
import ts from 'typescript';
import { Classifier, cleanup, predict } from '../src/lib/classifier.ts';

console.debug = () => {};
await tf.setBackend('cpu');
const fixtures = classifierFixtures();
const values = new Map();
let failSave = false;
let failWrite;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failSave || failWrite?.(key)) throw new Error('Simulated storage failure');
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key)
  }
});
tf.io.registerSaveRouter((url) => {
  if (typeof url !== 'string' || !url.startsWith('localstorage://classifier_test-')) return null;
  return {
    save: async (modelArtifacts) => {
      if (failSave) throw new Error('Simulated storage failure');
      const { weightData, ...metadata } = modelArtifacts;
      localStorage.setItem(
        `tensorflowjs_models/${url.slice('localstorage://'.length)}/artifacts`,
        JSON.stringify({ ...metadata, weightData: Buffer.from(weightData).toString('base64') })
      );
      return { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(modelArtifacts) };
    }
  };
});
tf.io.registerLoadRouter((url) => {
  if (typeof url !== 'string' || !url.startsWith('localstorage://classifier_test-')) return null;
  return {
    load: async () => {
      const { weightData, ...metadata } = JSON.parse(
        localStorage.getItem(`tensorflowjs_models/${url.slice('localstorage://'.length)}/artifacts`)
      );
      return { ...metadata, weightData: Uint8Array.from(Buffer.from(weightData, 'base64')).buffer };
    }
  };
});
afterEach(() => {
  cleanup(-1);
  values.clear();
  failSave = false;
  failWrite = undefined;
  assert.equal(tf.memory().numTensors, 0, 'Tensors must be released after training and cache cleanup');
});

for (const fixture of fixtures) {
  test(`held-out recognition quality: ${fixture.name}`, async (context) => {
    const training = new Set(fixture.training.positive);
    assert.ok([...fixture.test.positive, ...fixture.test.negative].every((text) => !training.has(text)));
    const classifier = new Classifier(`test-quality-${fixture.name}`);
    await classifier.trainModel(fixture.training.positive);
    const metrics = classificationMetrics(classifier, fixture.test);
    context.diagnostic(JSON.stringify(metrics));
    assert.ok(metrics.recall >= fixture.minimumRecall, JSON.stringify(metrics));
    assert.ok(metrics.falsePositiveRate <= fixture.maximumFalsePositiveRate, JSON.stringify(metrics));
  });
}

test('200 positive samples retain both classes in training and validation', async () => {
  const classifier = new Classifier('test-large', { epochs: 12 });
  await classifier.trainModel(Array.from({ length: 200 }, (_, i) => String(100000 + i)));
  assert.deepEqual(classifier.trainingReport.training, { positive: 160, negative: 160 });
  assert.deepEqual(classifier.trainingReport.validation, { positive: 40, negative: 40 });
});

test('minimum data trains and synthetic negatives cannot be unchanged or valid six-digit codes', async () => {
  const classifier = new Classifier('test-small', { epochs: 8 });
  const positive = ['123456', '234567', '345678'];
  const data = classifier.prepareTrainingData(positive);
  const train = new Set([...data.training.positive, ...data.training.negative]);
  assert.ok([...data.validation.positive, ...data.validation.negative].every((text) => !train.has(text)));
  assert.ok([...data.training.negative, ...data.validation.negative].every((text) => !/^\d{6}$/.test(text)));
  await classifier.trainModel(positive);
  assert.ok(Number.isFinite(classifier.predict('456789')));
  assert.equal(classifier.predict(' '), 0);
});

test('few-shot formats remain stable across training seeds and reject similar invalid values', async () => {
  for (const seed of [17, 42, 97]) {
    for (const [i, fixture] of fixtures.slice(0, 2).entries()) {
      const classifier = new Classifier(`test-few-shot-${seed}-${i}`, { seed });
      await classifier.trainModel(fixture.training.positive.slice(0, 3));
      const metrics = classificationMetrics(classifier, fixture.test);
      assert.ok(metrics.recall >= 0.95 && metrics.falsePositiveRate <= 0.05, JSON.stringify({ seed, i, ...metrics }));
    }
  }
});

test('minimum Chinese data does not increase confidence in an unrelated order notice', async () => {
  const classifier = new Classifier('test-chinese-minimum');
  await classifier.trainModel(fixtures[2].training.positive.slice(0, 3));
  // Broad sentence corruption with just two training positives raised this unrelated notice to 0.8.
  assert.ok(classifier.predict('订单3961987820尚未发货，请耐心等待') <= 0.5);
});

test('synthetic negatives exclude valid email addresses and HTTP URLs', () => {
  const samples = [
    ['alice@example.com', 'bob.smith@example.org', 'carol+tag@example.net', 'dave@other.example'],
    ['https://example.com/a', 'http://other.example/x', 'https://third.example/?q=1', 'https://fourth.example/#part']
  ];
  for (const positive of samples) {
    const classifier = new Classifier('test-valid-formats');
    const data = classifier.prepareTrainingData(positive);
    assert.ok(positive.every((text) => classifier.matchesFormat(text)));
    assert.ok(
      [...data.training.negative, ...data.validation.negative].every((text) => !classifier.matchesFormat(text))
    );
    assert.equal(data.training.negative.length, 32);
    assert.equal(data.validation.negative.length, 16);
  }
});

test('format inference cannot exclude a supplied positive with a different length or prefix', () => {
  for (const seed of [17, 42, 97]) {
    const classifier = new Classifier('test-format-veto', { seed });
    for (const positive of [
      ['AB12', 'CD34', 'EF567'],
      ['INV-123', 'INV-456', 'ORD-789']
    ]) {
      classifier.prepareTrainingData(positive);
      assert.ok(positive.every((text) => classifier.matchesFormat(text)));
    }
    classifier.prepareTrainingData(['AB12', 'CD34', 'EF567']);
    assert.equal(classifier.format.kind, 'pattern');
    assert.equal(classifier.matchesFormat('AB-12'), false);
  }
});

test('changing one identifier width preserves the other fields across training splits', async () => {
  for (const seed of [17, 42, 97]) {
    const classifier = new Classifier(`test-field-width-${seed}`, { seed });
    await classifier.trainModel(['INV-2025-123456', 'INV-2026-234567', 'INV-2027-3456789']);
    for (const text of ['INV-2031-654321', 'INV-2031-6543210']) {
      assert.ok(classifier.predict(text) >= 0.5, `${seed}: ${text}`);
    }
    for (const text of ['INV-2-654321', 'INV-22222-654321']) {
      assert.equal(classifier.predict(text), 0, `${seed}: ${text}`);
    }
  }
});

test('numeric version tags generalize beyond the digit widths seen during training', async () => {
  const training = Array.from({ length: 24 }, (_, i) => `v${1 + (i % 7)}.${Math.floor(i / 7)}.${(i * 3) % 10}`);
  for (const seed of [17, 42, 97]) {
    const classifier = new Classifier(`test-version-width-${seed}`, { seed });
    await classifier.trainModel(training);
    for (const text of ['v10.2.3', 'v1.20.3', 'v1.2.30', 'v100.20.300']) {
      assert.ok(classifier.predict(text) >= 0.5, `${seed}: ${text} = ${classifier.predict(text)}`);
    }
    for (const text of ['v1.2', 'v1.2.3.4', 'v1.2.x', '1.2.3']) assert.equal(classifier.predict(text), 0);
  }
  const score = await predict('test-version-width-42', 'v1.20.3');
  cleanup(-1);
  assert.equal(await predict('test-version-width-42', 'v1.20.3'), score);
});

test('retains structural features after more than 50 lexical features and excludes validation vocabulary', async () => {
  const classifier = new Classifier('test-features', { epochs: 10 });
  const fixture = fixtures[1];
  const data = classifier.prepareTrainingData(fixture.training.positive);
  await classifier.trainModel(fixture.training.positive);
  const text = fixture.training.positive[0];
  assert.ok(classifier.tokenizeText(text).length > 50);
  const vector = classifier.textToSequence(text);
  for (const token of ['LENGTH_25', 'HAS_DASH', 'DIGITS_AT_END']) {
    assert.equal(vector[classifier.tokenizer.get(token) - 1], 1);
  }
  const trainingTokens = new Set(
    [...data.training.positive, ...data.training.negative].flatMap((sample) => classifier.tokenizeText(sample))
  );
  assert.ok([...classifier.tokenizer.keys()].every((token) => trainingTokens.has(token)));
});

test('early stopping restores the validation loss of the best epoch', async () => {
  const classifier = new Classifier('test-best-epoch');
  const positive = fixtures[2].training.positive;
  const data = classifier.prepareTrainingData(positive);
  const history = await classifier.trainModel(positive);
  const { bestEpoch, epochs } = classifier.trainingReport;
  assert.ok(bestEpoch < epochs, 'This fixture must exercise early stopping');
  const expectedLoss = history.history.val_loss[bestEpoch - 1];
  const restoredLoss = tf.tidy(() => {
    const { inputs, labels } = classifier.encodeTrainingData(data.validation);
    return classifier.model.evaluate(inputs, labels)[0].dataSync()[0];
  });
  assert.ok(Math.abs(restoredLoss - expectedLoss) < 1e-5, `${restoredLoss} != ${expectedLoss}`);
});

test('normalizes boundary whitespace and handles Unicode and long text without leaking prediction tensors', async () => {
  const classifier = new Classifier('test-input-boundaries', { maxFeatures: 64 });
  await classifier.trainModel(fixtures[0].training.positive);
  const score = classifier.predict('098765');
  assert.equal(classifier.predict(' \r\n098765\t '), score);
  assert.ok(classifier.tokenizer.size <= 64);
  const tensors = tf.memory().numTensors;
  for (const text of ['１２３４５６', '😀🚀🎉', '123\u200b456', '123\u0000456', '中English123 '.repeat(1000)]) {
    const prediction = classifier.predict(text);
    assert.ok(Number.isFinite(prediction) && prediction >= 0 && prediction <= 1);
  }
  assert.equal(tf.memory().numTensors, tensors);
});

test('positive samples train a reproducible classifier and survive persistence, reload and rename', async () => {
  const fixture = fixtures[0];
  const classifier = new Classifier('test-roundtrip');
  await classifier.trainModel(fixture.training.positive);
  const metrics = classificationMetrics(classifier, fixture.test);
  assert.ok(metrics.recall >= 0.9, JSON.stringify(metrics));
  assert.ok(metrics.falsePositiveRate <= 0.1, JSON.stringify(metrics));
  assert.equal(classifier.trainingReport.syntheticNegatives, true);
  assert.equal(classifier.predict('0987654'), 0);
  const score = classifier.predict('098765');
  const repeated = new Classifier('test-repeated');
  await repeated.trainModel(fixture.training.positive);
  assert.equal(repeated.predict('098765'), score);
  cleanup(-1);
  assert.ok(Math.abs((await predict('test-roundtrip', '098765')) - score) < 1e-6);
  assert.equal(await predict('test-roundtrip', '0987654'), 0);
  Classifier.renameSavedModel('test-roundtrip', 'test-renamed');
  cleanup(-1);
  assert.ok(Math.abs((await predict('test-renamed', '098765')) - score) < 1e-6);
  assert.equal(localStorage.getItem('classifier_config_test-roundtrip'), null);
});

test('old embedding models without featureVersion retain their original input encoding', async () => {
  const id = 'test-legacy';
  const tokenizer = [
    ['MOSTLY_DIGITS', 1],
    ['STARTS_WITH_DIGIT', 2],
    ['ENDS_WITH_DIGIT', 3],
    ['NGRAM_2_12', 4],
    ['VERY_LONG', 5]
  ];
  const model = tf.sequential({
    layers: [
      tf.layers.embedding({
        inputDim: 6,
        outputDim: 2,
        inputLength: 50,
        embeddingsInitializer: tf.initializers.randomUniform({ seed: 7 })
      }),
      tf.layers.globalAveragePooling1d(),
      tf.layers.dense({
        units: 1,
        activation: 'sigmoid',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 7 })
      })
    ]
  });
  const sequence = [1, 2, 3, 4, ...new Array(46).fill(0)];
  const expected = tf.tidy(() => model.predict(tf.tensor2d([sequence])).dataSync()[0]);
  const expectedPadding = tf.tidy(() => model.predict(tf.zeros([1, 50])).dataSync()[0]);
  await model.save(`localstorage://classifier_${id}`);
  model.dispose();
  localStorage.setItem(`classifier_tokenizer_${id}`, JSON.stringify(tokenizer));
  localStorage.setItem(
    `classifier_config_${id}`,
    JSON.stringify({ maxSequenceLength: 50, embeddingDim: 2, modelTrained: true, tokenizerSize: 5 })
  );
  assert.ok(Math.abs((await predict(id, '123456')) - expected) < 1e-6);
  assert.ok(Math.abs((await predict(id, 'abcdefghijklmnopqrstuvwxyz'.repeat(3))) - expectedPadding) < 1e-6);
});

test('version 2 feature models retain their original encoding and prediction scores', async () => {
  const id = 'test-v2';
  const model = tf.sequential({ layers: [tf.layers.dense({ inputShape: [2], units: 1, activation: 'sigmoid' })] });
  tf.tidy(() => model.setWeights([tf.tensor2d([[1], [2]]), tf.tensor1d([-1])]));
  const expected = tf.tidy(() => model.predict(tf.tensor2d([[1, 1]])).dataSync()[0]);
  await model.save(`localstorage://classifier_${id}`);
  model.dispose();
  localStorage.setItem(
    `classifier_tokenizer_${id}`,
    JSON.stringify([
      ['ALL_DIGITS', 1],
      ['LENGTH_6', 2]
    ])
  );
  localStorage.setItem(
    `classifier_config_${id}`,
    JSON.stringify({
      maxSequenceLength: 50,
      embeddingDim: 32,
      modelTrained: true,
      tokenizerSize: 2,
      featureVersion: 2
    })
  );
  assert.equal(await predict(id, '123456'), expected);
  assert.equal(await predict(id, '1234567'), 0.5);
});

test('failed replacement preserves the cached model and releases training tensors', async () => {
  const id = 'test-failed-save';
  const fixture = fixtures[0];
  const classifier = new Classifier(id, { epochs: 8 });
  await classifier.trainModel(fixture.training.positive);
  const score = await predict(id, '123456');
  const tensors = tf.memory().numTensors;
  failSave = true;
  await assert.rejects(
    new Classifier(id, { epochs: 8 }).trainModel(fixture.training.positive),
    /Simulated storage failure/
  );
  assert.equal(await predict(id, '123456'), score);
  assert.equal(tf.memory().numTensors, tensors);
});

test('failed metadata replacement preserves the complete model after cache eviction', async () => {
  const id = 'test-failed-metadata';
  await new Classifier(id, { epochs: 8 }).trainModel(fixtures[0].training.positive);
  const score = await predict(id, '123456');
  const stored = new Map(values);
  failWrite = (key) => key === `classifier_config_${id}`;
  await assert.rejects(
    new Classifier(id, { epochs: 8 }).trainModel(fixtures[1].training.positive),
    /Simulated storage failure/
  );
  failWrite = undefined;
  assert.equal(await predict(id, '123456'), score);
  cleanup(-1);
  assert.equal(await predict(id, '123456'), score);
  assert.deepEqual(values, stored);
});

test('legacy format models survive rename and failed migration before an atomic upgrade', async () => {
  const id = 'test-migration/legacy';
  const renamed = 'test-migration/renamed';
  const model = tf.sequential({ layers: [tf.layers.dense({ inputShape: [2], units: 1, activation: 'sigmoid' })] });
  tf.tidy(() => model.setWeights([tf.tensor2d([[1], [2]]), tf.tensor1d([-1])]));
  const expected = tf.tidy(() => model.predict(tf.tensor2d([[1, 1]])).dataSync()[0]);
  await model.save(`localstorage://classifier_${id}`);
  model.dispose();
  localStorage.setItem(
    `classifier_tokenizer_${id}`,
    JSON.stringify([
      ['LENGTH_6', 1],
      ['FORMAT_MATCH', 2]
    ])
  );
  localStorage.setItem(
    `classifier_config_${id}`,
    JSON.stringify({
      maxSequenceLength: 50,
      embeddingDim: 32,
      modelTrained: true,
      tokenizerSize: 2,
      featureVersion: 3,
      format: { kind: 'pattern', source: '^v[0-9]{1}\\.[0-9]{1}\\.[0-9]{1}$' }
    })
  );
  assert.equal(await predict(id, 'v1.2.3'), expected);
  assert.equal(await predict(id, 'v10.2.3'), 0, 'Existing v3 format restrictions must remain unchanged');
  Classifier.renameSavedModel(id, renamed);
  cleanup(-1);
  assert.equal(await predict(renamed, 'v1.2.3'), expected);
  const stored = new Map(values);
  failWrite = (key) => key === `classifier_config_${renamed}`;
  await assert.rejects(
    new Classifier(renamed, { epochs: 8 }).trainModel(fixtures[0].training.positive),
    /Simulated storage failure/
  );
  failWrite = undefined;
  cleanup(-1);
  assert.equal(await predict(renamed, 'v1.2.3'), expected);
  assert.deepEqual(values, stored);

  const neighborKey = `tensorflowjs_models/classifier_${renamed}-neighbor/artifacts`;
  localStorage.setItem(neighborKey, 'unrelated model');
  const upgraded = new Classifier(renamed, { epochs: 8 });
  await upgraded.trainModel(fixtures[0].training.positive);
  const score = upgraded.predict('123456');
  const saved = JSON.parse(localStorage.getItem(`classifier_config_${renamed}`));
  assert.ok(saved.artifacts && saved.tokenizer);
  assert.equal(localStorage.getItem(`classifier_tokenizer_${renamed}`), null);
  assert.equal(localStorage.getItem(`tensorflowjs_models/classifier_${renamed}/artifacts`), null);
  assert.equal(localStorage.getItem(neighborKey), 'unrelated model');
  assert.ok(Classifier.getModelInfo(renamed).sizeKB > 0);
  assert.equal(Classifier.getModelInfo(renamed).vocabulary, saved.tokenizer.length);
  cleanup(-1);
  assert.equal(await predict(renamed, '123456'), score);
  Classifier.clearSavedModel(renamed);
  assert.equal(await predict(renamed, '123456'), null);
  assert.deepEqual(Classifier.getModelInfo(renamed), { sizeKB: 0, vocabulary: 0 });
  assert.equal(localStorage.getItem(neighborKey), 'unrelated model');
});

test('a failed initial atomic save leaves no partial model', async () => {
  failSave = true;
  await assert.rejects(
    new Classifier('test-first-save', { epochs: 8 }).trainModel(fixtures[0].training.positive),
    /Simulated storage failure/
  );
  failSave = false;
  assert.equal(localStorage.length, 0);
  assert.equal(await predict('test-first-save', '123456'), null);
});

test('normalizes array input and rejects insufficient samples before allocating tensors', async () => {
  assert.deepEqual(Classifier.normalizeSamples(['  abc ', 'abc', '', ' def ']), ['abc', 'def']);
  const classifier = new Classifier('test-invalid');
  await assert.rejects(classifier.trainModel(['abc', ' abc ']), /3 positive/);
  assert.throws(() => new Classifier('test-invalid-config', { epochs: 0 }), /Invalid classifier/);
});

test('failed editor retraining retains the old samples and permits retrying the same new samples', async () => {
  const id = 'test-editor-retry';
  const oldSamples = fixtures[0].training.positive.join('\n');
  const newSamples = fixtures[1].training.positive.join('\n');
  await new Classifier(id, { epochs: 8 }).trainModel(oldSamples);
  const oldScore = await predict(id, '123456');
  let attempts = 0;
  class EditorClassifier extends Classifier {
    constructor(id) {
      super(id, { epochs: 8 });
    }
    async trainModel(samples) {
      attempts++;
      return super.trainModel(samples);
    }
  }
  const model = { id, sample: oldSamples, modelTrained: true, icon: 'Sphere', threshold: 0.5 };
  const editor = modelEditor(model, newSamples, EditorClassifier);
  failSave = true;
  editor.save();
  await editor.settle();
  failSave = false;
  assert.equal(model.sample, oldSamples);
  assert.equal(model.modelTrained, true);
  assert.equal(await predict(id, '123456'), oldScore);
  assert.equal(attempts, 1);

  editor.save();
  await editor.settle();
  assert.equal(attempts, 2);
  assert.equal(model.sample, newSamples);
  assert.equal(editor.alerts.at(-1), 'model_training_success');
  assert.equal(await predict(id, '123456'), 0);
  const score = await predict(id, fixtures[1].test.positive[0]);
  cleanup(-1);
  assert.equal(await predict(id, fixtures[1].test.positive[0]), score);
});

test('deletion while the editor waits for paint prevents training from starting', async () => {
  const painting = deferred();
  let attempts = 0;
  class EditorClassifier extends Classifier {
    async trainModel(samples) {
      attempts++;
      return super.trainModel(samples);
    }
  }
  const model = { id: 'test-delete-before-training', sample: fixtures[0].training.positive.join('\n') };
  const editor = modelEditor(model, model.sample, EditorClassifier, () => painting.promise);
  const pending = editor.train();
  editor.models.splice(0, 1);
  Classifier.clearSavedModel(model.id);
  painting.resolve();
  await pending;
  assert.equal(attempts, 0);
  assert.equal(values.size, 0);
  assert.deepEqual(editor.alerts, []);
});

test('deletion during training prevents saved data and success messages from reappearing', async () => {
  const started = deferred();
  class EditorClassifier extends Classifier {
    constructor(id) {
      super(id, { epochs: 8 });
    }
    async trainModel(samples) {
      const pending = super.trainModel(samples);
      started.resolve();
      return pending;
    }
  }
  const model = { id: 'test-delete-during-training', sample: fixtures[0].training.positive.join('\n') };
  const editor = modelEditor(model, model.sample, EditorClassifier);
  const pending = editor.train();
  await started.promise;
  assert.ok(tf.memory().numTensors > 2, 'Training has allocated tensors before deletion');
  editor.models.splice(0, 1);
  Classifier.clearSavedModel(model.id);
  await pending;
  assert.equal(values.size, 0);
  assert.equal(await predict(model.id, '123456'), null);
  assert.deepEqual(editor.alerts, []);
});

test('deletion stops training at the next batch boundary instead of finishing the epoch', async () => {
  const classifier = new Classifier('test-cancel-batch', { epochs: 8 });
  const createModel = classifier.createModel.bind(classifier);
  let batches = 0;
  classifier.createModel = () => {
    const model = createModel();
    const fit = model.fit.bind(model);
    model.fit = (inputs, labels, options) => {
      const callbacks = options.callbacks;
      return fit(inputs, labels, {
        ...options,
        callbacks: {
          ...callbacks,
          onBatchEnd: async (batch, logs) => {
            if (++batches === 1) Classifier.clearSavedModel('test-cancel-batch');
            await callbacks.onBatchEnd?.(batch, logs);
          }
        }
      });
    };
    return model;
  };
  await assert.rejects(classifier.trainModel(Array.from({ length: 200 }, (_, i) => String(100000 + i))), {
    name: 'AbortError'
  });
  assert.equal(batches, 1);
  assert.equal(values.size, 0);
});

test('a deleted or superseded training result cannot overwrite a newer model with the same ID', async () => {
  for (const deleted of [false, true]) {
    const id = `test-superseded-${deleted}`;
    const saving = deferred();
    const resume = deferred();
    const older = new Classifier(id, { epochs: 8 });
    older.saveModel = async (...args) => {
      saving.resolve();
      await resume.promise;
      return Classifier.prototype.saveModel.call(older, ...args);
    };
    const pending = older.trainModel(fixtures[0].training.positive);
    const cancelled = assert.rejects(pending, { name: 'AbortError' });
    await saving.promise;
    if (deleted) Classifier.clearSavedModel(id);
    const newer = new Classifier(id, { epochs: 8 });
    await newer.trainModel(fixtures[1].training.positive);
    const text = fixtures[1].test.positive[0];
    const score = newer.predict(text);
    const saved = values.get(`classifier_config_${id}`);
    resume.resolve();
    await cancelled;
    assert.equal(values.get(`classifier_config_${id}`), saved);
    assert.equal(await predict(id, text), score);
    assert.equal(await predict(id, '123456'), 0);
    cleanup(-1);
    assert.equal(await predict(id, text), score);
  }
});

test('deletion after the storage write cannot republish the training model into the cache', async () => {
  const id = 'test-delete-after-write';
  failWrite = (key) => {
    if (key === `classifier_config_${id}`) queueMicrotask(() => Classifier.clearSavedModel(id));
    return false;
  };
  await assert.rejects(new Classifier(id, { epochs: 8 }).trainModel(fixtures[0].training.positive), {
    name: 'AbortError'
  });
  assert.equal(values.size, 0);
  assert.equal(await predict(id, '123456'), null);
});

test('renaming invalidates pending retraining while preserving the saved model at its new ID', async () => {
  const id = 'test-rename-training';
  const renamed = `${id}/renamed`;
  await new Classifier(id, { epochs: 8 }).trainModel(fixtures[0].training.positive);
  const score = await predict(id, '123456');
  const saving = deferred();
  const resume = deferred();
  const replacement = new Classifier(id, { epochs: 8 });
  replacement.saveModel = async (...args) => {
    saving.resolve();
    await resume.promise;
    return Classifier.prototype.saveModel.call(replacement, ...args);
  };
  const cancelled = assert.rejects(replacement.trainModel(fixtures[1].training.positive), { name: 'AbortError' });
  await saving.promise;
  Classifier.renameSavedModel(id, renamed);
  resume.resolve();
  await cancelled;
  assert.equal(await predict(id, '123456'), null);
  cleanup(-1);
  assert.equal(await predict(renamed, '123456'), score);
  assert.equal(values.has(`classifier_config_${id}`), false);
});

test('repetition features preserve the legacy regex semantics for Unicode and line endings', () => {
  const classifier = new Classifier('test-repetition');
  const samples = ['', 'a', 'aa', 'abab', 'ababa', '😀😀', '\u0000\u0000', '\ud800\ud800'];
  const random = randomGenerator(2701);
  const alphabet = ['a', 'b', '中', '\n', '\r', '\u2028', '\u2029', '\ud83d', '\ude00'];
  for (let i = 0; i < 2000; i++) {
    const part = Array.from(
      { length: 1 + Math.floor(random() * 24) },
      () => alphabet[Math.floor(random() * alphabet.length)]
    ).join('');
    samples.push(part.repeat(1 + (i % 4)), `${part.repeat(2)}x`);
  }
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) samples.push(`abab${ending}`);
  for (const text of samples) {
    assert.equal(classifier.extractPatternFeatures(text).includes('REPEATING_PATTERN'), /^(.+)\1+$/.test(text));
  }
});

test('unstructured models evaluate long near-repeating text without a format shortcut or tensor leaks', async () => {
  const classifier = new Classifier('test-unstructured-long', { epochs: 8 });
  await classifier.trainModel(fixtures[2].training.positive);
  assert.equal(classifier.format, undefined);
  const tensors = tf.memory().numTensors;
  for (const text of ['a'.repeat(99999) + 'b', '请参加每周项目会议。'.repeat(9999) + '终', 'ab'.repeat(50000)]) {
    const score = classifier.predict(text);
    assert.ok(Number.isFinite(score) && score >= 0 && score <= 1);
  }
  assert.equal(tf.memory().numTensors, tensors);
});

test('deduplicated n-grams preserve feature order and predictions for repeated and Unicode text', async () => {
  const classifier = new Classifier('test-ngram-order', { epochs: 8 });
  await classifier.trainModel(fixtures[2].training.positive);
  const addNgrams = classifier.addCharNgrams.bind(classifier);
  const legacy = (text, min, max, features) => {
    const normalized = text.toLowerCase();
    const tokens = [];
    for (let n = min; n <= max; n++) {
      for (let i = 0; i <= normalized.length - n; i++) tokens.push(`NGRAM_${n}_${normalized.slice(i, i + n)}`);
    }
    tokens.forEach((token) => features.add(token));
  };
  for (const text of [
    ...fixtures[2].test.positive.slice(0, 3),
    'ab'.repeat(5000),
    '中文😀Ab12\n'.repeat(1000),
    'İ中\ud800AB\r\n1234'
  ]) {
    classifier.addCharNgrams = legacy;
    const expectedFeatures = classifier.tokenizeText(text);
    const expectedScore = classifier.predict(text);
    classifier.addCharNgrams = addNgrams;
    assert.deepEqual(classifier.tokenizeText(text), expectedFeatures);
    assert.equal(classifier.predict(text), expectedScore);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

// Run the component's actual handlers with plain state and DOM/store stubs; this is not native UI automation.
function modelEditor(model, samples, ClassifierType, tick = async () => {}) {
  const source = readFileSync(new URL('../src/lib/components/Model.svelte', import.meta.url), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('Model.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handlers = ast.statements
    .filter((node) => ts.isFunctionDeclaration(node) && ['save', 'train'].includes(node.name?.text))
    .map((node) => node.getText(ast).replace(/^export\s+/, ''));
  assert.equal(handlers.length, 2);
  const compiled = ts.transpileModule(handlers.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return new Function(
    'Classifier',
    'model',
    'samples',
    'tick',
    `
    const models = [model], alerts = [];
    const m = new Proxy({}, { get: (_, key) => () => key });
    const alert = (message) => alerts.push(message);
    const document = { visibilityState: 'hidden' };
    const modal = { close() {} }, form = { closest: () => ({ close() {} }) };
    const updateCaseId = () => {}, MODEL_MARK = 'model-';
    const DEFAULT_ICON = 'Sphere', DEFAULT_THRESHOLD = 0.5;
    let training = false, disposed = false, finishPendingPaint;
    let modelId = model.id, modelName = model.id, modelSample = samples;
    let modelIcon = model.icon, modelThreshold = model.threshold;
    ${compiled}
    let pending;
    const originalTrain = train;
    train = (...args) => (pending = originalTrain(...args));
    return { models, alerts, save: () => save(form), settle: () => pending, train: () => train(model.id) };
  `
  )(ClassifierType, model, samples, tick);
}

// Constructed examples, not production data. Test seeds and templates are separate from training.
function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function examples(kind, seed, count, heldOut) {
  const random = randomGenerator(seed);
  const digits = (length) => Array.from({ length }, () => Math.floor(random() * 10)).join('');
  const letters = () => String.fromCharCode(65 + Math.floor(random() * 26), 65 + Math.floor(random() * 26));
  const positive = new Set();
  const negative = new Set();
  for (let i = 0; positive.size < count || negative.size < count; i++) {
    if (kind === 'six-digit-code') {
      const value = digits(6);
      positive.add(value);
      negative.add([digits(5), digits(7), `${value.slice(0, 3)}A${value.slice(4)}`, `-${value}`, `${value}.0`][i % 5]);
    } else if (kind === 'long-order-number') {
      const date = `${heldOut ? '2026' : '2025'}${String(1 + (i % 12)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}`;
      const tail = `${letters()}${digits(10)}`;
      const value = `ORD-${date}-${tail}`;
      positive.add(value);
      negative.add(
        [
          `INV-${date}-${tail}`,
          `ORD-${date}-${tail.slice(0, -1)}`,
          `ORD-${date}-${tail}7`,
          `ORD${date}-${tail}`,
          `查询 ${value}`
        ][i % 5]
      );
    } else {
      const station = ['东门', '西门', '南门', '北门'][i % 4];
      const code = digits(4);
      const tracking = digits(10);
      const positives = heldOut
        ? [
            `您的包裹${tracking}已经送达${station}驿站，请凭取件码${code}领取`,
            `快递${tracking}已入库，取件码${code}，请前往${station}取件`
          ]
        : [
            `包裹${tracking}已到达${station}驿站，请凭${code}取件`,
            `您的快递${tracking}已到${station}，取件码：${code}`
          ];
      const negatives = heldOut
        ? [
            `包裹${tracking}仍在运输途中，预计明日送达${station}`,
            `您的验证码为${code}，请勿向他人泄露`,
            `订单${tracking}尚未发货，请耐心等待`
          ]
        : [
            `快递${tracking}运输中，预计明天抵达${station}`,
            `登录验证码：${code}，五分钟内有效`,
            `订单${tracking}支付成功，等待商家发货`
          ];
      positive.add(positives[i % positives.length]);
      negative.add(negatives[i % negatives.length]);
    }
  }
  return { positive: [...positive].slice(0, count), negative: [...negative].slice(0, count) };
}

function classifierFixtures() {
  return [
    { name: 'six-digit-code', minimumRecall: 0.9, maximumFalsePositiveRate: 0.1 },
    { name: 'long-order-number', minimumRecall: 0.9, maximumFalsePositiveRate: 0.25 },
    { name: 'pickup-notification', minimumRecall: 0.7, maximumFalsePositiveRate: 0.3 }
  ].map((fixture, i) => ({
    ...fixture,
    training: { positive: examples(fixture.name, 1000 + i, 24, false).positive },
    test: examples(fixture.name, 9000 + i, 80, true)
  }));
}

function classificationMetrics(classifier, data, threshold = 0.5) {
  const tp = data.positive.filter((text) => classifier.predict(text) >= threshold).length;
  const fp = data.negative.filter((text) => classifier.predict(text) >= threshold).length;
  return {
    tp,
    fp,
    fn: data.positive.length - tp,
    tn: data.negative.length - fp,
    precision: tp / Math.max(1, tp + fp),
    recall: tp / data.positive.length,
    falsePositiveRate: fp / data.negative.length,
    accuracy: (tp + data.negative.length - fp) / (data.positive.length + data.negative.length)
  };
}
