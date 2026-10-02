import * as tf from '@tensorflow/tfjs';

/**
 * Model storage key constants.
 */
const STORAGE = {
  CLASSIFIER: 'classifier',
  CONFIG: 'classifier_config',
  TOKENIZER: 'classifier_tokenizer'
} as const;

/**
 * Training parameters configuration.
 */
export interface TrainingConfig {
  epochs?: number; // maximum training epochs, default 100
  batchSize?: number; // batch size, default 16
  validationSplit?: number; // validation split ratio, default 0.2
  learningRate?: number; // learning rate, default 0.03
  maxSequenceLength?: number; // legacy sequence model configuration
  embeddingDim?: number; // legacy sequence model configuration
  negativeRatio?: number; // negative samples ratio relative to positive, default 1.0
  maxNegativeSamples?: number; // synthetic negative sample limit, default 1000
  maxFeatures?: number; // vocabulary limit, default 4096
  patience?: number; // epochs without validation improvement, default 12
  seed?: number; // seed for reproducible data preparation, default 42
}

/**
 * Default training configuration.
 */
const DEFAULT_TRAINING_CONFIG: Required<TrainingConfig> = {
  epochs: 100,
  batchSize: 16,
  validationSplit: 0.2,
  learningRate: 0.03,
  maxSequenceLength: 50,
  embeddingDim: 32,
  negativeRatio: 1.0,
  maxNegativeSamples: 1000,
  maxFeatures: 4096,
  patience: 12,
  seed: 42
};

export interface TrainingReport {
  training: { positive: number; negative: number };
  validation: { positive: number; negative: number };
  syntheticNegatives: boolean;
  epochs: number;
  bestEpoch: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
}

type FormatProfile = { kind: 'email' | 'http-url' | 'version' } | { kind: 'pattern'; source: string };

// HTML's practical email syntax; this checks shape, not mailbox existence.
// https://html.spec.whatwg.org/dev/input.html#email-state-(type=email)
const EMAIL_FORMAT =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
// Numeric v-prefixed version tags have variable-width components, unlike fixed-width identifiers.
const VERSION_FORMAT = /^v[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Model cache interface.
 */
interface ModelCache {
  model: tf.LayersModel;
  tokenizer: Map<string, number>;
  config: {
    maxSequenceLength: number;
    embeddingDim: number;
    modelTrained: boolean;
    tokenizerSize: number;
    featureVersion?: number;
    format?: FormatProfile;
  };
  lastUsed: number; // last used time, for cache cleanup
}

// New saves commit all model data in the existing config key. The optional fields preserve legacy reads.
type SavedModel = ModelCache['config'] & {
  tokenizer?: [string, number][];
  artifacts?: Omit<tf.io.ModelArtifacts, 'weightData'> & { weightData: string };
};

/**
 * Global model cache map.
 *
 * key: model ID, value: model cache object
 */
const MODEL_CACHE = new Map<string, ModelCache>();
// share active reads only; saving or deleting an ID invalidates its older load
const MODEL_LOADS = new Map<string, Promise<void>>();
// Only the latest unfinished training for an ID may publish its result.
const MODEL_TRAININGS = new Map<string, symbol>();
const MODEL_CACHE_MAX_AGE = 60 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Text classifier with automatically generated negative samples.
 */
export class Classifier {
  private id: string;
  private model: tf.LayersModel | null = null;
  private tokenizer: Map<string, number> = new Map();
  private embeddingDim: number;
  private maxSequenceLength: number;
  private trainingConfig: Required<TrainingConfig>;
  private modelTrained = false; // whether the model has been trained
  private featureVersion = 4;
  private format?: FormatProfile;
  private randomState: number;
  trainingReport: TrainingReport | null = null;

  // create a new classifier instance with optional configuration
  constructor(id: string, config?: TrainingConfig) {
    this.id = id;
    this.trainingConfig = { ...DEFAULT_TRAINING_CONFIG, ...config };
    const {
      epochs,
      batchSize,
      validationSplit,
      learningRate,
      negativeRatio,
      maxNegativeSamples,
      maxFeatures,
      patience
    } = this.trainingConfig;
    if (
      ![epochs, batchSize, maxNegativeSamples, maxFeatures, patience].every(
        (value) => Number.isInteger(value) && value > 0
      ) ||
      !(validationSplit > 0 && validationSplit < 1) ||
      !Number.isFinite(learningRate) ||
      learningRate <= 0 ||
      !Number.isFinite(negativeRatio) ||
      negativeRatio <= 0
    ) {
      throw new Error('Invalid classifier training configuration');
    }
    this.maxSequenceLength = this.trainingConfig.maxSequenceLength;
    this.embeddingDim = this.trainingConfig.embeddingDim;
    this.randomState = this.trainingConfig.seed >>> 0;
  }

  // create classifier instance from cache
  static fromCache(id: string, cached: ModelCache): Classifier {
    const classifier = new Classifier(id, {
      maxSequenceLength: cached.config.maxSequenceLength,
      embeddingDim: cached.config.embeddingDim
    });
    classifier.model = cached.model;
    classifier.tokenizer = new Map(cached.tokenizer);
    classifier.modelTrained = cached.config.modelTrained;
    classifier.featureVersion = cached.config.featureVersion ?? 1;
    classifier.format = cached.config.format;
    return classifier;
  }

  /**
   * Train and save a single-class model, releasing temporary tensors and the training optimizer on every exit.
   * A failed replacement leaves the previous cached model available.
   *
   * @param positiveTrainingData - positive samples as an array or newline-separated text
   * @returns training history after saving succeeds; rejects on validation, training or storage failure
   */
  async trainModel(positiveTrainingData: string[] | string): Promise<tf.History> {
    const positive = Classifier.validateTrainingData(positiveTrainingData);
    if (!positive) {
      throw new Error('Training requires at least 3 positive samples');
    }

    const training = Symbol();
    MODEL_TRAININGS.set(this.id, training);
    const isCurrent = () => MODEL_TRAININGS.get(this.id) === training;
    const assertCurrent = () => {
      if (!isCurrent()) throw new DOMException('Model training was cancelled', 'AbortError');
    };
    let trainedModel: tf.LayersModel | undefined;
    let optimizer: tf.Optimizer | undefined;
    let tensors: tf.Tensor[] = [];
    let bestWeights: tf.Tensor[] = [];
    this.trainingReport = null;
    this.featureVersion = 4;
    this.randomState = this.trainingConfig.seed >>> 0;
    try {
      const data = this.prepareTrainingData(positive);
      // Validation examples must never contribute to the vocabulary.
      this.buildVocabulary([...data.training.positive, ...data.training.negative]);
      const training = this.encodeTrainingData(data.training);
      tensors.push(training.inputs, training.labels);
      const validation = this.encodeTrainingData(data.validation);
      tensors.push(validation.inputs, validation.labels);

      trainedModel = this.createModel();
      optimizer = trainedModel.optimizer;
      this.model = trainedModel;
      let bestLoss = Infinity;
      let bestEpoch = 0;
      let waiting = 0;
      const { epochs, batchSize, patience } = this.trainingConfig;
      const positiveCount = data.training.positive.length;
      const negativeCount = data.training.negative.length;
      const history = await trainedModel.fit(training.inputs, training.labels, {
        epochs,
        batchSize,
        // The rows have already been shuffled with the configured seed.
        shuffle: false,
        validationData: [validation.inputs, validation.labels],
        classWeight: {
          0: (positiveCount + negativeCount) / (2 * negativeCount),
          1: (positiveCount + negativeCount) / (2 * positiveCount)
        },
        verbose: 0,
        callbacks: {
          onBatchEnd: () => {
            if (!isCurrent()) trainedModel!.stopTraining = true;
          },
          onEpochEnd: (epoch, logs) => {
            if (!isCurrent()) {
              trainedModel!.stopTraining = true;
              return;
            }
            const loss = logs?.val_loss;
            if (loss === undefined || !Number.isFinite(loss)) {
              throw new Error('Training produced an invalid validation loss');
            }
            if (loss < bestLoss - 0.0001) {
              tf.dispose(bestWeights);
              // getWeights() exposes model-owned tensors; keep independent snapshots.
              bestWeights = trainedModel!.getWeights().map((weight) => weight.clone());
              bestLoss = loss;
              bestEpoch = epoch + 1;
              waiting = 0;
            } else if (++waiting >= patience) {
              trainedModel!.stopTraining = true;
            }
          }
        }
      });
      assertCurrent();
      // TF.js 4.22 does not implement EarlyStopping.restoreBestWeights.
      trainedModel.setWeights(bestWeights);
      this.trainingReport = tf.tidy(() => {
        const scores = (trainedModel!.predict(validation.inputs) as tf.Tensor).dataSync();
        const labels = validation.labels.dataSync();
        let truePositive = 0;
        let falsePositive = 0;
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] >= 0.5) {
            if (labels[i] === 1) truePositive++;
            else falsePositive++;
          }
        }
        return {
          training: { positive: positiveCount, negative: negativeCount },
          validation: {
            positive: data.validation.positive.length,
            negative: data.validation.negative.length
          },
          syntheticNegatives: true,
          epochs: history.epoch.length,
          bestEpoch,
          precision: truePositive / Math.max(1, truePositive + falsePositive),
          recall: truePositive / data.validation.positive.length,
          falsePositiveRate: falsePositive / data.validation.negative.length
        };
      });
      tf.dispose(tensors);
      tensors = [];
      this.modelTrained = true;
      await this.saveModel(assertCurrent);
      return history;
    } catch (error) {
      if (trainedModel && MODEL_CACHE.get(this.id)?.model !== trainedModel) {
        trainedModel.dispose();
        this.model = null;
        this.modelTrained = false;
      }
      this.trainingReport = null;
      throw error;
    } finally {
      tf.dispose(tensors);
      tf.dispose(bestWeights);
      optimizer?.dispose();
      if (isCurrent()) MODEL_TRAININGS.delete(this.id);
    }
  }

  /** Train a regularized binary feature classifier without padding or sequence truncation. */
  private createModel(): tf.LayersModel {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [this.tokenizer.size],
          units: 1,
          activation: 'sigmoid',
          kernelInitializer: 'zeros',
          kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
        })
      ]
    });
    const optimizer = tf.train.adam(this.trainingConfig.learningRate);
    try {
      model.compile({ optimizer, loss: 'binaryCrossentropy', metrics: ['accuracy'] });
      return model;
    } catch (error) {
      model.dispose();
      optimizer.dispose();
      throw error;
    }
  }

  private buildVocabulary(texts: string[]): void {
    const frequency = new Map<string, number>();
    for (const text of texts) {
      for (const token of this.tokenizeText(text)) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }
    // Reserve structural features before selecting frequent lexical features.
    const isLexical = (token: string) => /^(NGRAM_|WORD_|PREFIX_|SUFFIX_)/.test(token);
    const ranked = [...frequency]
      // One-off fragments mostly memorize individual identifiers in small datasets.
      .filter(([token, count]) => !isLexical(token) || count >= 2)
      .sort(
        ([a, countA], [b, countB]) =>
          Number(isLexical(a)) - Number(isLexical(b)) || countB - countA || a.localeCompare(b)
      );
    this.tokenizer.clear();
    for (const [token] of ranked.slice(0, this.trainingConfig.maxFeatures)) {
      this.tokenizer.set(token, this.tokenizer.size + 1);
    }
  }

  // universal text tokenization (applicable to any type of text pattern)
  private tokenizeText(text: string): string[] {
    // Version component values and widths do not identify the category. Keep earlier encodings intact.
    if (this.featureVersion >= 4 && this.format?.kind === 'version' && VERSION_FORMAT.test(text)) {
      text = 'v0.0.0';
    }
    // extract pattern features
    const patternFeatures = this.extractPatternFeatures(text);

    // multi-granular tokenization
    const tokens = new Set<string>();

    // 1. character-level features
    const charFeatures = this.extractCharacterFeatures(text);
    charFeatures.forEach((feature) => tokens.add(feature));

    // 2. n-gram features (character-level)
    this.addCharNgrams(text, 2, 4, tokens);

    // 3. word-level features
    const wordTokens = this.extractWordTokens(text);
    wordTokens.forEach((token) => tokens.add(token));

    // 4. pattern features
    patternFeatures.forEach((feature) => tokens.add(feature));

    // 5. position features
    const positionFeatures = this.extractPositionFeatures(text);
    positionFeatures.forEach((feature) => tokens.add(feature));

    if (this.featureVersion >= 2) {
      tokens.add(`LENGTH_${text.length}`);
      // Exact shapes describe short structured values without storing long text in feature names.
      if (text.length <= 80) tokens.add(`SHAPE_${this.characterShape(text)}`);
      const normalized = text.toLowerCase();
      for (let length = 1; length <= Math.min(4, text.length); length++) {
        tokens.add(`PREFIX_${normalized.slice(0, length)}`);
        tokens.add(`SUFFIX_${normalized.slice(-length)}`);
      }
    }

    if (this.featureVersion >= 3 && this.format) {
      tokens.add(this.matchesFormat(text) ? 'FORMAT_MATCH' : 'FORMAT_MISMATCH');
    }

    return Array.from(tokens);
  }

  // extract universal pattern features (applicable to various text types)
  private extractPatternFeatures(text: string): string[] {
    const features: string[] = [];

    // length features
    if (text.length <= 5) features.push('VERY_SHORT');
    else if (text.length <= 10) features.push('SHORT');
    else if (text.length <= 20) features.push('MEDIUM');
    else if (text.length <= 50) features.push('LONG');
    else features.push('VERY_LONG');

    // numeric patterns
    if (/^\d+$/.test(text)) {
      features.push('ALL_DIGITS');
      // add specific length features (common length ranges)
      const len = text.length;
      if (len >= 4 && len <= 20) {
        features.push(`DIGITS_${len}`);
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) features.push('DATE_FORMAT');
    if (/^\d{4}\d{2}\d{2}$/.test(text)) features.push('DATE_COMPACT');

    // alphanumeric pattern
    if (/^[A-Z0-9-]+$/.test(text.toUpperCase())) features.push('ALPHANUMERIC_DASH');
    if (/^[A-Z0-9]+$/.test(text.toUpperCase())) features.push('ALPHANUMERIC');
    if (/^[A-Z]+\d+$/.test(text.toUpperCase())) features.push('LETTERS_THEN_DIGITS');
    if (/^\d+[A-Z]+$/.test(text.toUpperCase())) features.push('DIGITS_THEN_LETTERS');

    // delimiter patterns
    if (text.includes('-')) features.push('HAS_DASH');
    if (text.includes('_')) features.push('HAS_UNDERSCORE');
    if (text.includes('.')) features.push('HAS_DOT');
    if (text.includes('/')) features.push('HAS_SLASH');
    if (text.includes(':')) features.push('HAS_COLON');
    if (text.includes(' ')) features.push('HAS_SPACE');

    // case patterns
    if (/^[A-Z]+$/.test(text)) features.push('ALL_UPPERCASE');
    if (/^[a-z]+$/.test(text)) features.push('ALL_LOWERCASE');
    if (/^[A-Z][a-z]+$/.test(text)) features.push('TITLE_CASE');
    if (/[A-Z]/.test(text) && /[a-z]/.test(text)) features.push('MIXED_CASE');

    // repeated character patterns
    if (/(.)\1{2,}/.test(text)) features.push('HAS_REPEATED_CHARS');
    if (this.hasRepeatingPattern(text)) features.push('REPEATING_PATTERN');

    // special characters
    if (/[!@#$%^&*(),.?":{}|<>]/.test(text)) features.push('HAS_SPECIAL_CHARS');
    if (/^[\u4e00-\u9fa5]+$/.test(text)) features.push('ALL_CHINESE');
    if (/[\u4e00-\u9fa5]/.test(text)) features.push('HAS_CHINESE');

    return features;
  }

  private hasRepeatingPattern(text: string): boolean {
    // Preserve the regex's UTF-16 and line-terminator semantics without backtracking.
    if (text.length < 2 || /[\r\n\u2028\u2029]/.test(text)) return false;

    // Prefix lengths give the shortest possible repeating period in linear time.
    const prefixes = new Uint32Array(text.length);
    for (let i = 1, matched = 0; i < text.length; i++) {
      while (matched > 0 && text[i] !== text[matched]) matched = prefixes[matched - 1];
      if (text[i] === text[matched]) matched++;
      prefixes[i] = matched;
    }
    const period = text.length - prefixes[text.length - 1];
    return period < text.length && text.length % period === 0;
  }

  // extract character-level features
  private extractCharacterFeatures(text: string): string[] {
    const features: string[] = [];
    const chars = text.toLowerCase().split('');

    // character type statistics
    const digitCount = chars.filter((c) => /\d/.test(c)).length;
    const letterCount = chars.filter((c) => /[a-z]/.test(c)).length;
    const spaceCount = chars.filter((c) => c === ' ').length;
    const specialCount = chars.filter((c) => !/[a-z0-9\s]/.test(c)).length;

    // proportion features
    const total = text.length;
    if (digitCount / total > 0.5) features.push('MOSTLY_DIGITS');
    if (letterCount / total > 0.5) features.push('MOSTLY_LETTERS');
    if (spaceCount / total > 0.1) features.push('MANY_SPACES');
    if (specialCount / total > 0.1) features.push('MANY_SPECIAL');

    // first and last character
    if (text.length > 0) {
      const first = text[0];
      const last = text[text.length - 1];

      if (/\d/.test(first)) features.push('STARTS_WITH_DIGIT');
      if (/[A-Za-z]/.test(first)) features.push('STARTS_WITH_LETTER');
      if (/\d/.test(last)) features.push('ENDS_WITH_DIGIT');
      if (/[A-Za-z]/.test(last)) features.push('ENDS_WITH_LETTER');
    }

    return features;
  }

  // Add directly to the feature set, preserving first occurrence order for legacy encodings.
  private addCharNgrams(text: string, minN: number, maxN: number, tokens: Set<string>): void {
    const normalizedText = text.toLowerCase();

    for (let n = minN; n <= maxN; n++) {
      const prefix = `NGRAM_${n}_`;
      for (let i = 0; i <= normalizedText.length - n; i++) {
        tokens.add(prefix + normalizedText.substring(i, i + n));
      }
    }
  }

  // extract word-level features
  private extractWordTokens(text: string): string[] {
    const tokens: string[] = [];

    // split by various delimiters
    const words = text
      .toLowerCase()
      .split(/[\s\-_./\\:,;!?]+/)
      .filter((word) => word.length > 0);

    words.forEach((word) => {
      if (word.length <= 15) {
        // limit word length to avoid overly long tokens
        tokens.push(`WORD_${word}`);
      }
    });

    // word count features
    if (words.length === 1) tokens.push('SINGLE_WORD');
    else if (words.length <= 3) tokens.push('FEW_WORDS');
    else if (words.length <= 10) tokens.push('MANY_WORDS');
    else tokens.push('VERY_MANY_WORDS');

    return tokens;
  }

  // extract position features
  private extractPositionFeatures(text: string): string[] {
    const features: string[] = [];

    // digit position features
    const digitPositions = [];
    for (let i = 0; i < text.length; i++) {
      if (/\d/.test(text[i])) {
        digitPositions.push(i);
      }
    }

    if (digitPositions.length > 0) {
      const firstDigit = digitPositions[0];
      const lastDigit = digitPositions[digitPositions.length - 1];

      if (firstDigit === 0) features.push('DIGITS_AT_START');
      if (lastDigit === text.length - 1) features.push('DIGITS_AT_END');
      if (firstDigit > 0 && lastDigit < text.length - 1) features.push('DIGITS_IN_MIDDLE');
    }

    // continuous digit segments
    const digitSegments = text.match(/\d+/g) || [];
    digitSegments.forEach((segment) => {
      const len = segment.length;
      if (len === 2) features.push('TWO_DIGIT_SEGMENT');
      else if (len === 3) features.push('THREE_DIGIT_SEGMENT');
      else if (len === 4) features.push('FOUR_DIGIT_SEGMENT');
      else if (len >= 5) features.push('LONG_DIGIT_SEGMENT');
    });

    return features;
  }

  private random(): number {
    // Local PRNG: training must not replace the application's Math.random.
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  private shuffle<T>(values: T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private splitSamples(values: string[]): { training: string[]; validation: string[] } {
    const shuffled = this.shuffle(values);
    const count = Math.max(
      1,
      Math.min(values.length - 1, Math.floor(values.length * this.trainingConfig.validationSplit))
    );
    return { training: shuffled.slice(count), validation: shuffled.slice(0, count) };
  }

  private prepareTrainingData(positive: string[]) {
    const positives = this.splitSamples(positive);
    this.format = this.inferFormat(positives.training);
    // Held-out positives may veto an overly narrow format, but never supply its literals or vocabulary.
    if (this.format && positives.validation.some((text) => !this.matchesFormat(text))) {
      this.format = this.inferFormat(positives.training, positives.validation);
      if (positives.validation.some((text) => !this.matchesFormat(text))) this.format = undefined;
    }
    const diversify = this.format || this.isContinuousChinese(positives.training);
    // A few randomly chosen counterexamples cannot represent all the nearby invalid formats.
    const countFor = (count: number, minimum: number) =>
      Math.min(
        this.trainingConfig.maxNegativeSamples,
        Math.max(minimum, Math.ceil(count * this.trainingConfig.negativeRatio))
      );
    // Split the source examples first. Augmentations stay on their source's side.
    const trainingNegative = this.generateNegativeSamples(
      positives.training,
      countFor(positives.training.length, diversify ? 32 : 2),
      positive
    );
    const validationNegative = this.generateNegativeSamples(
      positives.validation,
      countFor(positives.validation.length, diversify ? 16 : 2),
      [...positive, ...trainingNegative],
      positives.training
    );
    return {
      training: { positive: positives.training, negative: trainingNegative },
      validation: { positive: positives.validation, negative: validationNegative }
    };
  }

  private encodeTrainingData(data: { positive: string[]; negative: string[] }) {
    const rows = this.shuffle([
      ...data.positive.map((text) => ({ text, label: 1 })),
      ...data.negative.map((text) => ({ text, label: 0 }))
    ]);
    return tf.tidy(() => ({
      inputs: tf.tensor2d(rows.map(({ text }) => this.textToSequence(text))),
      labels: tf.tensor1d(rows.map(({ label }) => label))
    }));
  }

  /** Infer compact structures; held-out examples can relax individual length constraints. */
  private inferFormat(positive: string[], lengthChecks: string[] = []): FormatProfile | undefined {
    if (positive.every((text) => EMAIL_FORMAT.test(text))) return { kind: 'email' };
    if (positive.every((text) => this.isHttpUrl(text))) return { kind: 'http-url' };
    if (positive.every((text) => VERSION_FORMAT.test(text))) return { kind: 'version' };
    if (positive.some((text) => text.length > 80 || !/^[A-Za-z0-9._:/-]+$/.test(text))) return;
    if (!positive.every((text) => /\d/.test(text))) return;

    const parts = positive.map((text) => text.match(/[A-Za-z]+|\d+|[^A-Za-z\d]/g)!);
    const kind = (part: string) => (/^\d+$/.test(part) ? 'digit' : /^[A-Za-z]+$/.test(part) ? 'letter' : part);
    const first = parts[0];
    const checkedParts = lengthChecks.map((text) => text.match(/[A-Za-z]+|\d+|[^A-Za-z\d]/g) ?? []);
    if (parts.some((row) => row.length !== first.length || row.some((part, i) => kind(part) !== kind(first[i]))))
      return;
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = first
      .map((part, i) => {
        const column = parts.map((row) => row[i]);
        if (kind(part) !== 'digit' && kind(part) !== 'letter') return escape(part);
        // Keep a shared leading label (e.g. a project prefix), but never memorize a shared year or ID.
        if (i === 0 && kind(part) === 'letter' && column.every((value) => value === part)) return escape(part);
        let alphabet = '[A-Za-z]';
        if (kind(part) === 'digit') alphabet = '[0-9]';
        else if (column.every((value) => /^[A-Z]+$/.test(value))) alphabet = '[A-Z]';
        else if (column.every((value) => /^[a-z]+$/.test(value))) alphabet = '[a-z]';
        const length =
          column.every((value) => value.length === part.length) &&
          checkedParts.every((row) => row[i]?.length === part.length)
            ? `{${part.length}}`
            : '+';
        return alphabet + length;
      })
      .join('');
    return { kind: 'pattern', source: `^(?:${source})$` };
  }

  private isHttpUrl(text: string): boolean {
    // URL() repairs missing slashes and whitespace; require an explicit, intact input first.
    if (!/^https?:\/\/[^/\s?#][^\s\\]*$/i.test(text)) return false;
    try {
      const url = new URL(text);
      return Boolean(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:');
    } catch {
      return false;
    }
  }

  private matchesFormat(text: string): boolean {
    if (this.format?.kind === 'email') return EMAIL_FORMAT.test(text);
    if (this.format?.kind === 'http-url') return this.isHttpUrl(text);
    if (this.format?.kind === 'version') return VERSION_FORMAT.test(text);
    return this.format?.kind !== 'pattern' || new RegExp(this.format.source).test(text);
  }

  private isContinuousChinese(samples: string[]): boolean {
    // Whole-content corruption is useful for continuous Chinese. In Latin/mixed prose it can
    // teach topic overlap instead of intent (e.g. scheduling versus cancelling the same meeting).
    // Two training examples after the minimum-size split do not support this broader augmentation.
    return samples.length >= 3 && samples.every((text) => /[\u4e00-\u9fa5]/.test(text) && !/[A-Za-z]/.test(text));
  }

  /** Generate negatives outside the inferred format; matching shapes alone cannot protect valid emails/URLs. */
  private generateNegativeSamples(
    positive: string[],
    count: number,
    excluded: string[],
    reference: string[] = positive
  ): string[] {
    const forbidden = new Set(excluded);
    const negatives = new Set<string>();
    const fixedLength = new Set(reference.map((text) => text.length)).size === 1;
    const signature = (text: string) => {
      const shape = this.characterShape(text);
      return fixedLength ? shape : shape.replace(/(.)\1+/g, '$1');
    };
    const positiveShapes = new Set(reference.map(signature));
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-_/.:@中文测试';
    const naturalText = !this.format && this.isContinuousChinese(reference);
    const chinese = [...new Set(reference.join('').match(/[\u4e00-\u9fa5]/g) ?? [])];
    for (let attempt = 0; negatives.size < count && attempt < count * 100; attempt++) {
      const base = positive[Math.floor(this.random() * positive.length)];
      const position = Math.floor(this.random() * base.length);
      const character = alphabet[Math.floor(this.random() * alphabet.length)];
      let candidate: string;
      if (naturalText && attempt % 5 !== 4) {
        // A typo or a different tracking number may still express the same intent. Replace the
        // complete lexical content while retaining layout and numbers, so those cannot separate classes.
        candidate = base.replace(/[A-Za-z\u4e00-\u9fa5]/g, (char) => {
          if (/[\u4e00-\u9fa5]/.test(char)) return chinese[Math.floor(this.random() * chinese.length)];
          return String.fromCharCode((char === char.toUpperCase() ? 65 : 97) + Math.floor(this.random() * 26));
        });
      } else
        switch (attempt % 5) {
          case 0:
            candidate = base.slice(0, position) + base.slice(position + 1);
            break;
          case 1:
            candidate = base.slice(0, position) + character + base.slice(position);
            break;
          case 2:
            candidate = base.slice(0, position) + character + base.slice(position + 1);
            break;
          case 3:
            candidate = this.shuffle(Array.from(base)).join('');
            break;
          default: {
            const length = 1 + Math.floor(this.random() * Math.min(80, base.length * 2));
            candidate = Array.from({ length }, () => alphabet[Math.floor(this.random() * alphabet.length)]).join('');
          }
        }
      candidate = candidate.trim();
      // A shuffled number (or an unchanged string) is not evidence of a negative class.
      if (
        candidate &&
        !forbidden.has(candidate) &&
        (this.format ? !this.matchesFormat(candidate) : naturalText || !positiveShapes.has(signature(candidate)))
      ) {
        negatives.add(candidate);
      }
    }
    if (negatives.size < count) {
      throw new Error('Unable to generate distinct negative samples from the training data');
    }
    return [...negatives];
  }

  private characterShape(text: string): string {
    return text
      .replace(/[A-Za-z]/g, 'L')
      .replace(/\d/g, 'D')
      .replace(/[\u4e00-\u9fa5]/g, 'H');
  }

  private textToSequence(text: string): number[] {
    const tokens = this.tokenizeText(text);
    if (this.featureVersion >= 2) {
      const features = new Array<number>(this.tokenizer.size).fill(0);
      for (const token of tokens) {
        const id = this.tokenizer.get(token);
        if (id !== undefined) features[id - 1] = 1;
      }
      return features;
    }
    // Preserve the exact encoding used by models saved before feature version 2.
    const sequence = tokens.map((token) => this.tokenizer.get(token) || 0).slice(0, this.maxSequenceLength);
    while (sequence.length < this.maxSequenceLength) sequence.push(0);
    return sequence;
  }

  /**
   * Predict whether text belongs to the target category and refresh the cached model's idle time.
   *
   * @param text - text to classify
   * @returns synchronous classification score, or zero for an unavailable model or empty/unknown input
   */
  predict(text: string): number {
    if (!this.model || !this.modelTrained) {
      console.warn('Model not loaded or not trained');
      return 0;
    }

    // validation for empty input
    if (!text || text.trim().length === 0) {
      console.warn('Empty input text');
      return 0;
    }

    const cached = MODEL_CACHE.get(this.id);
    if (cached?.model === this.model) {
      cached.lastUsed = Date.now();
    }

    const normalized = this.featureVersion >= 2 ? text.trim() : text;
    if (this.featureVersion >= 3 && !this.matchesFormat(normalized)) return 0;
    const sequence = this.textToSequence(normalized);
    if (sequence.every((value) => value === 0)) {
      // Legacy models also accepted a known token beyond the truncated sequence.
      if (this.featureVersion >= 2 || !this.tokenizeText(text).some((token) => this.tokenizer.has(token))) return 0;
    }
    return tf.tidy(() => {
      const input = tf.tensor2d([sequence]);
      const prediction = this.model!.predict(input) as tf.Tensor;
      return prediction.dataSync()[0];
    });
  }

  /**
   * Save the current model and replace its cached predecessor only after persistence succeeds.
   *
   * @param assertCurrent - reject results invalidated by deletion, renaming or a newer training run
   * @returns promise resolving after storage and cache updates; rejects on storage failure
   */
  async saveModel(assertCurrent?: () => void): Promise<void> {
    if (!this.model) {
      console.warn('No model to save');
      return;
    }

    try {
      const config = {
        maxSequenceLength: this.maxSequenceLength,
        embeddingDim: this.embeddingDim,
        modelTrained: this.modelTrained,
        tokenizerSize: this.tokenizer.size,
        featureVersion: this.featureVersion,
        format: this.format
      };
      const legacyKeys = [`${STORAGE.TOKENIZER}_${this.id}`, ...Classifier.getModelStorageKeys(this.id)];
      await this.model.save(
        tf.io.withSaveHandler(async (artifacts) => {
          const { weightData, ...metadata } = artifacts;
          const bytes = new Uint8Array(
            (Array.isArray(weightData) ? tf.io.concatenateArrayBuffers(weightData) : weightData) ?? new ArrayBuffer(0)
          );
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
          }
          const saved: SavedModel = {
            ...config,
            tokenizer: Array.from(this.tokenizer.entries()),
            artifacts: { ...metadata, weightData: btoa(binary) }
          };
          const result = { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(artifacts) };
          // setItem either replaces this complete record or leaves the previous model intact.
          assertCurrent?.();
          localStorage.setItem(`${STORAGE.CONFIG}_${this.id}`, JSON.stringify(saved));
          return result;
        })
      );

      assertCurrent?.();
      // invalidate older reads before replacing the cache with the newly saved model
      MODEL_LOADS.delete(this.id);
      const previous = MODEL_CACHE.get(this.id);
      MODEL_CACHE.set(this.id, {
        model: this.model,
        tokenizer: new Map(this.tokenizer),
        config: { ...config },
        lastUsed: Date.now()
      });
      if (previous && previous.model !== this.model) {
        previous.model.dispose();
      }
      scheduleCleanup();

      // Migration cleanup cannot turn a successful commit into a reported training failure.
      try {
        legacyKeys.forEach((key) => localStorage.removeItem(key));
      } catch (error) {
        console.warn(`Failed to remove obsolete model storage: ${error}`);
      }

      console.debug(`Model saved and cached successfully, tokenizer size: ${this.tokenizer.size}`);
    } catch (error) {
      console.error(`Failed to save model: ${error}`);
      throw error;
    }
  }

  /**
   * Load a cached or persisted model, sharing concurrent reads for the same ID.
   * Superseded/deleted loads release their weights instead of restoring stale cache entries.
   *
   * @returns true after restoring a current model; false when missing, deleted or loading fails
   */
  async loadModel(): Promise<boolean> {
    try {
      let cached = MODEL_CACHE.get(this.id);
      if (!cached) {
        let pending = MODEL_LOADS.get(this.id);
        if (!pending) {
          pending = (async () => {
            const configData = localStorage.getItem(`${STORAGE.CONFIG}_${this.id}`);
            if (!configData) return;
            const { tokenizer: savedTokenizer, artifacts, ...config }: SavedModel = JSON.parse(configData);
            const tokenizerData = artifacts
              ? savedTokenizer
              : JSON.parse(localStorage.getItem(`${STORAGE.TOKENIZER}_${this.id}`) ?? 'null');
            if (!tokenizerData) return;

            let loadedModel: tf.LayersModel | undefined;
            try {
              loadedModel = await tf.loadLayersModel(
                artifacts
                  ? tf.io.fromMemory({
                      ...artifacts,
                      weightData: Uint8Array.from(atob(artifacts.weightData), (char) => char.charCodeAt(0)).buffer
                    })
                  : `localstorage://${STORAGE.CLASSIFIER}_${this.id}`
              );
              // deletion or a successful save may have invalidated this read while weights were loading
              if (MODEL_LOADS.get(this.id) !== pending) {
                return;
              }

              const tokenizer = new Map<string, number>(tokenizerData);
              if (config.tokenizerSize && config.tokenizerSize !== tokenizer.size) {
                throw new Error(`Tokenizer size mismatch: expected=${config.tokenizerSize}, actual=${tokenizer.size}`);
              }
              if ((config.featureVersion ?? 1) >= 2 && loadedModel.inputs[0].shape[1] !== tokenizer.size) {
                throw new Error('Model input size does not match its tokenizer');
              }

              MODEL_CACHE.set(this.id, {
                model: loadedModel,
                tokenizer,
                config,
                lastUsed: Date.now()
              });
              loadedModel = undefined; // ownership has transferred to the cache
              scheduleCleanup();
            } finally {
              loadedModel?.dispose();
            }
          })();
          MODEL_LOADS.set(this.id, pending);
        }

        try {
          await pending;
        } finally {
          if (MODEL_LOADS.get(this.id) === pending) {
            MODEL_LOADS.delete(this.id);
          }
        }
        cached = MODEL_CACHE.get(this.id);
      }

      if (!cached) {
        return false;
      }
      this.model = cached.model;
      this.tokenizer = new Map(cached.tokenizer);
      this.maxSequenceLength = cached.config.maxSequenceLength;
      this.embeddingDim = cached.config.embeddingDim;
      this.modelTrained = cached.config.modelTrained;
      this.featureVersion = cached.config.featureVersion ?? 1;
      this.format = cached.config.format;
      cached.lastUsed = Date.now();
      return true;
    } catch (error) {
      console.error(`Failed to load model: ${error}`);
      this.model = null;
      this.tokenizer.clear();
      this.modelTrained = false;
      return false;
    }
  }

  // debug method
  debugInfo() {
    console.debug(`=== Classifier Debug Info ===`);
    console.debug(`Model ID: ${this.id}`);
    console.debug(`Tokenizer size: ${this.tokenizer.size}`);
    console.debug(`Max sequence length: ${this.maxSequenceLength}`);
    console.debug(`Embedding dim: ${this.embeddingDim}`);
    console.debug(`Model exists: ${!!this.model}`);
    console.debug(`Trained: ${this.modelTrained}`);

    if (this.tokenizer.size > 0) {
      console.debug(
        `Sample tokens: ${Array.from(this.tokenizer.entries())
          .slice(0, 10)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')}`
      );
    }

    console.debug(`TensorFlow.js backend: ${tf.getBackend()}`);
    console.debug(`Memory: ${JSON.stringify(tf.memory())}`);
  }

  static normalizeSamples(data: string[] | string): string[] {
    const values = typeof data === 'string' ? data.split('\n') : Array.isArray(data) ? data : [];
    return [
      ...new Set(
        values
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ];
  }

  static validateTrainingData(data: string[] | string): string[] | null {
    const samples = Classifier.normalizeSamples(data);
    return samples.length >= 3 ? samples : null;
  }

  // get model detailed info (including storage size and vocabulary count)
  static getModelInfo(id: string): { sizeKB: number; vocabulary: number } {
    let sizeKB = 0;
    let vocabulary = 0;

    if (typeof localStorage !== 'undefined') {
      try {
        // vocabulary count
        const configKey = `${STORAGE.CONFIG}_${id}`;
        const configData = localStorage.getItem(configKey);
        if (configData) {
          const config = JSON.parse(configData);
          // use saved tokenizer size
          vocabulary = config.tokenizerSize || 0;
        }

        // storage size
        let totalSize = 0;
        for (const key of [configKey, `${STORAGE.TOKENIZER}_${id}`, ...Classifier.getModelStorageKeys(id)]) {
          const value = localStorage.getItem(key);
          if (value) {
            // estimate UTF-16 encoded byte size (JavaScript strings are UTF-16)
            totalSize += key.length * 2 + value.length * 2;
          }
        }
        sizeKB = parseFloat((totalSize / 1024).toFixed(2));
      } catch (error) {
        console.error(`Failed to get model info: ${error}`);
      }
    }

    return { sizeKB, vocabulary };
  }

  // Match the complete model path, including IDs that contain slashes.
  private static getModelStorageKeys(id: string): string[] {
    const path = `tensorflowjs_models/${STORAGE.CLASSIFIER}_${id}`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.slice(0, key.lastIndexOf('/')) === path) {
        keys.push(key);
      }
    }
    return keys;
  }

  /**
   * Rename persisted artifacts and the cached model without retraining or disposing its weights.
   * Copy failures leave the old model intact; existing destination data is never overwritten.
   *
   * @param id - current model ID
   * @param newId - new model ID
   * @throws if the destination exists or storage writes fail
   */
  static renameSavedModel(id: string, newId: string): void {
    if (id === newId) {
      return;
    }
    const metadata = [STORAGE.CONFIG, STORAGE.TOKENIZER];
    if (
      MODEL_CACHE.has(newId) ||
      Classifier.getModelStorageKeys(newId).length > 0 ||
      metadata.some((prefix) => localStorage.getItem(`${prefix}_${newId}`) !== null)
    ) {
      throw new Error(`Saved model already exists: ${newId}`);
    }

    const keys = [
      ...metadata.map((prefix) => [`${prefix}_${id}`, `${prefix}_${newId}`]),
      ...Classifier.getModelStorageKeys(id).map((key) => [
        key,
        `tensorflowjs_models/${STORAGE.CLASSIFIER}_${newId}/${key.slice(key.lastIndexOf('/') + 1)}`
      ])
    ];
    try {
      for (const [from, to] of keys) {
        const value = localStorage.getItem(from);
        if (value !== null) localStorage.setItem(to, value);
      }
    } catch (error) {
      for (const [, to] of keys) localStorage.removeItem(to);
      throw error;
    }
    for (const [from] of keys) localStorage.removeItem(from);

    MODEL_LOADS.delete(id);
    MODEL_LOADS.delete(newId);
    MODEL_TRAININGS.delete(id);
    MODEL_TRAININGS.delete(newId);
    const cached = MODEL_CACHE.get(id);
    if (cached) {
      MODEL_CACHE.delete(id);
      cached.lastUsed = Date.now();
      MODEL_CACHE.set(newId, cached);
    }
    scheduleCleanup();
  }

  /**
   * Delete a model's storage and cache, invalidating unfinished loading and training for the same ID.
   *
   * @param id - model ID to remove
   * @returns immediately after synchronous removal; storage failures are logged
   */
  static clearSavedModel(id: string): void {
    try {
      MODEL_LOADS.delete(id);
      MODEL_TRAININGS.delete(id);
      // remove from cache and clean up resources
      const cached = MODEL_CACHE.get(id);
      if (cached) {
        if (cached.model && typeof cached.model.dispose === 'function') {
          cached.model.dispose();
        }
        MODEL_CACHE.delete(id);
        console.debug(`Cleared model from cache: ${id}`);
      }
      scheduleCleanup();

      localStorage.removeItem(`${STORAGE.CONFIG}_${id}`);
      localStorage.removeItem(`${STORAGE.TOKENIZER}_${id}`);

      // clear TensorFlow model
      Classifier.getModelStorageKeys(id).forEach((key) => localStorage.removeItem(key));

      console.debug('Cleared saved model data from localStorage');
    } catch (error) {
      console.error(`Failed to clear saved model: ${error}`);
    }
  }

  // clear saved model data of current instance
  clearSavedModel() {
    Classifier.clearSavedModel(this.id);
  }
}

/**
 * Global prediction function.
 * Parameters are model ID and text, get model from cache map directly, or try to load from localStorage if not found.
 *
 * @param modelId - model ID
 * @param text - text to predict
 * @returns classification score, or null when the model is unavailable
 */
export async function predict(modelId: string, text: string): Promise<number | null> {
  try {
    // first try to get from cache
    let cached = MODEL_CACHE.get(modelId);

    if (!cached) {
      // not in cache, try to load
      console.debug(`Model not in cache, attempting to load: ${modelId}`);
      const classifier = new Classifier(modelId);
      const loadSuccess = await classifier.loadModel();

      if (!loadSuccess) {
        console.warn(`Unable to load model: ${modelId}`);
        return null;
      }

      // after successful loading, get from cache again
      cached = MODEL_CACHE.get(modelId);
      if (!cached) {
        console.error(`Model not found in cache after loading: ${modelId}`);
        return null;
      }
    }

    // update last used time
    cached.lastUsed = Date.now();

    // check if model is trained
    if (!cached.config.modelTrained) {
      console.warn(`Model not trained yet: ${modelId}`);
      return null;
    }

    // use cached model for prediction
    const classifier = Classifier.fromCache(modelId, cached);
    const result = classifier.predict(text);
    return result;
  } catch (error) {
    console.error(`Prediction failed: ${error}`);
    return null;
  }
}

/**
 * Clean up expired models in cache (unused longer than specified time).
 *
 * @param maxAge - maximum lifetime (milliseconds), default 1 hour
 * @returns immediately after disposing expired models and scheduling the next idle check
 */
export function cleanup(maxAge: number = MODEL_CACHE_MAX_AGE): void {
  const now = Date.now();
  const toDelete: string[] = [];

  for (const [id, entry] of MODEL_CACHE.entries()) {
    if (now - entry.lastUsed > maxAge) {
      toDelete.push(id);
    }
  }

  for (const id of toDelete) {
    const cached = MODEL_CACHE.get(id);
    if (cached && cached.model && typeof cached.model.dispose === 'function') {
      cached.model.dispose();
    }
    MODEL_CACHE.delete(id);
    console.debug(`Cleaning up expired cached model: ${id}`);
  }

  if (toDelete.length > 0) {
    console.debug(`Cleaned up ${toDelete.length} expired models`);
  }
  scheduleCleanup();
}

/**
 * Schedule one check at the earliest cache expiry, cancelling it when the cache becomes empty.
 * Predictions are synchronous, and training models enter the cache only after fitting/saving finishes.
 *
 * @returns immediately; the timer rechecks lastUsed before disposing idle models
 */
function scheduleCleanup(): void {
  if (cleanupTimer !== undefined) {
    clearTimeout(cleanupTimer);
    cleanupTimer = undefined;
  }
  if (MODEL_CACHE.size === 0) {
    return;
  }

  const oldest = Math.min(...Array.from(MODEL_CACHE.values(), (entry) => entry.lastUsed));
  cleanupTimer = setTimeout(
    () => {
      cleanupTimer = undefined;
      cleanup();
    },
    Math.max(0, oldest + MODEL_CACHE_MAX_AGE + 1 - Date.now())
  );
}
