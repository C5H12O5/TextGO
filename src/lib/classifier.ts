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
  };
  lastUsed: number; // last used time, for cache cleanup
}

/**
 * Global model cache map.
 *
 * key: model ID, value: model cache object
 */
const MODEL_CACHE = new Map<string, ModelCache>();

/**
 * Text classifier based on synthetic negative samples.
 */
export class Classifier {
  private id: string;
  private model: tf.LayersModel | null = null;
  private tokenizer: Map<string, number> = new Map();
  private maxSequenceLength = 50; // shorten sequence length, suitable for small samples
  private embeddingDim = 32; // embedding dimension
  private modelTrained = false;

  // create a new classifier instance
  constructor(id: string) {
    this.id = id;
  }

  // train single-class text classification model
  async trainModel(positiveTrainingData: string[] | string) {
    console.debug('Preparing training data for single-class model...');

    // 0. validate and preprocess training data
    const processedData = Classifier.validateTrainingData(positiveTrainingData);
    if (!processedData) {
      throw new Error('Training data format invalid or insufficient samples');
    }

    try {
      // 1. build vocabulary
      this.buildVocabulary(processedData);

      // 2. generate negative samples and prepare training data
      const { inputs, labels } = this.prepareTrainingData(processedData);

      console.debug(`Input shape: ${inputs.shape}, dtype: ${inputs.dtype}`);
      console.debug(`Labels shape: ${labels.shape}, dtype: ${labels.dtype}`);

      // 3. create model
      this.model = this.createModel();

      // 4. train
      console.debug('Starting to train single-class model...');
      const history = await this.model.fit(inputs, labels, {
        epochs: 50, // increase training epochs
        batchSize: 8, // small batch training
        validationSplit: 0.2,
        shuffle: true,
        verbose: 1,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.debug(`Epoch ${epoch + 1}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`);
            if (logs?.val_loss) {
              console.debug(`  val_loss=${logs.val_loss.toFixed(4)}, val_acc=${logs?.val_acc?.toFixed(4)}`);
            }
          }
        }
      });

      // 5. clean up tensor memory
      inputs.dispose();
      labels.dispose();

      // 6. save model and tokenizer
      this.modelTrained = true;
      await this.saveModel();

      console.debug('Single-class model trained successfully!');
      return history;
    } catch (error) {
      console.error(`Training failed: ${error}`);
      this.debugInfo();
      throw error;
    }
  }

  // create single-class classification model
  private createModel(): tf.LayersModel {
    console.debug(`Creating single-class model, vocabulary size: ${this.tokenizer.size}`);

    const model = tf.sequential({
      layers: [
        // embedding layer
        tf.layers.embedding({
          inputDim: this.tokenizer.size + 1,
          outputDim: this.embeddingDim,
          inputLength: this.maxSequenceLength
        }),

        // global average pooling
        tf.layers.globalAveragePooling1d(),

        // hidden layer
        tf.layers.dense({ units: 16, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.3 }),

        // output layer: single neuron, sigmoid activation for binary classification
        tf.layers.dense({
          units: 1,
          activation: 'sigmoid'
        })
      ]
    });

    // use binary classification loss function
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  // build vocabulary (only process positive samples)
  private buildVocabulary(positiveData: string[]) {
    const vocabulary = new Set<string>();

    // extract feature vocabulary
    positiveData.forEach((text) => {
      const tokens = this.tokenizeText(text);
      tokens.forEach((token) => vocabulary.add(token));
    });

    // build mapping
    let tokenIndex = 1; // 0 reserved for unknown words
    vocabulary.forEach((token) => {
      this.tokenizer.set(token, tokenIndex++);
    });

    console.debug(`Vocabulary size: ${this.tokenizer.size}`);
  }

  // universal text tokenization (applicable to any type of text pattern)
  private tokenizeText(text: string): string[] {
    // extract pattern features
    const patternFeatures = this.extractPatternFeatures(text);

    // multi-granular tokenization
    const tokens = new Set<string>();

    // 1. character-level features
    const charFeatures = this.extractCharacterFeatures(text);
    charFeatures.forEach((feature) => tokens.add(feature));

    // 2. n-gram features (character-level)
    const charNgrams = this.extractCharNgrams(text, 2, 4);
    charNgrams.forEach((ngram) => tokens.add(ngram));

    // 3. word-level features
    const wordTokens = this.extractWordTokens(text);
    wordTokens.forEach((token) => tokens.add(token));

    // 4. pattern features
    patternFeatures.forEach((feature) => tokens.add(feature));

    // 5. position features
    const positionFeatures = this.extractPositionFeatures(text);
    positionFeatures.forEach((feature) => tokens.add(feature));

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
    if (/^(.+)\1+$/.test(text)) features.push('REPEATING_PATTERN');

    // special characters
    if (/[!@#$%^&*(),.?":{}|<>]/.test(text)) features.push('HAS_SPECIAL_CHARS');
    if (/^[\u4e00-\u9fa5]+$/.test(text)) features.push('ALL_CHINESE');
    if (/[\u4e00-\u9fa5]/.test(text)) features.push('HAS_CHINESE');

    return features;
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

  // extract character n-gram features
  private extractCharNgrams(text: string, minN: number, maxN: number): string[] {
    const ngrams: string[] = [];
    const normalizedText = text.toLowerCase();

    for (let n = minN; n <= maxN; n++) {
      for (let i = 0; i <= normalizedText.length - n; i++) {
        const ngram = normalizedText.substring(i, i + n);
        ngrams.push(`NGRAM_${n}_${ngram}`);
      }
    }

    return ngrams;
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

  // prepare single-class training data
  private prepareTrainingData(positiveData: string[]) {
    const sequences: number[][] = [];
    const labels: number[] = [];

    // process positive samples
    positiveData.forEach((text) => {
      const tokens = this.tokenizeText(text);
      const sequence = tokens.map((token) => this.tokenizer.get(token) || 0).slice(0, this.maxSequenceLength);

      // pad or truncate to fixed length
      while (sequence.length < this.maxSequenceLength) {
        sequence.push(0);
      }

      sequences.push(sequence);
      labels.push(1); // mark positive samples as 1
    });

    // generate negative samples (through randomization and noise injection)
    const negativeCount = Math.min(positiveData.length, 20); // limit negative sample count
    for (let i = 0; i < negativeCount; i++) {
      const negativeSequence = this.generateNegativeSample();
      sequences.push(negativeSequence);
      labels.push(0); // mark negative samples as 0
    }

    // convert to tensors
    const inputTensor = tf.tensor2d(sequences, [sequences.length, this.maxSequenceLength], 'float32');
    const labelsTensor = tf.tensor1d(labels, 'float32');

    console.debug(`Creating tensors - Input: shape=${inputTensor.shape}, dtype=${inputTensor.dtype}`);
    console.debug(`Creating tensors - Labels: shape=${labelsTensor.shape}, dtype=${labelsTensor.dtype}`);
    console.debug(`Creating tensors - Samples: positive=${positiveData.length}, negative=${negativeCount}`);

    return {
      inputs: inputTensor,
      labels: labelsTensor
    };
  }

  // generate negative sample
  private generateNegativeSample(): number[] {
    const sequence: number[] = [];
    const vocabSize = this.tokenizer.size;

    // generate random sequence
    for (let i = 0; i < this.maxSequenceLength; i++) {
      if (Math.random() < 0.3) {
        // 30% probability to add random vocabulary
        sequence.push(Math.floor(Math.random() * vocabSize) + 1);
      } else {
        // 70% probability to pad with 0
        sequence.push(0);
      }
    }

    return sequence;
  }

  // predict whether text belongs to target category
  predict(text: string): number {
    if (!this.model || !this.modelTrained) {
      console.warn('Model not loaded or not trained');
      return 0;
    }

    const tokens = this.tokenizeText(text);
    console.debug(`Extracted tokens: ${tokens.slice(0, 10).join(', ')}`);

    const sequence = tokens.map((token) => this.tokenizer.get(token) || 0).slice(0, this.maxSequenceLength);
    console.debug(`Token sequence (first 10): ${sequence.slice(0, 10).join(', ')}`);
    console.debug(`Non-zero token count: ${sequence.filter((x) => x > 0).length}`);

    // pad to fixed length
    while (sequence.length < this.maxSequenceLength) {
      sequence.push(0);
    }

    // check if sequence is all zeros
    const nonZeroCount = sequence.filter((x) => x > 0).length;
    if (nonZeroCount === 0) {
      console.warn(`Input text contains no known tokens: text="${text}"`);
      console.debug(`Tokenizer size: ${this.tokenizer.size}`);
      console.debug(`Extracted tokens (first 10): ${tokens.slice(0, 10).join(', ')}`);
      console.debug(
        `Vocab sample: ${Array.from(this.tokenizer.entries())
          .slice(0, 5)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')}`
      );

      // try to find at least one matching token
      const matchingTokens = tokens.filter((token) => this.tokenizer.has(token));
      console.debug(`Matching tokens found: ${matchingTokens.slice(0, 5).join(', ')}`);

      if (matchingTokens.length === 0) {
        console.warn('No matching tokens found');
        return 0;
      }
    }

    try {
      // use float32 to maintain consistency with training
      const input = tf.tensor2d([sequence], [1, this.maxSequenceLength], 'float32');
      const prediction = this.model.predict(input) as tf.Tensor;
      const confidence = prediction.dataSync()[0]; // probability value of sigmoid output

      console.debug(`Raw prediction confidence: ${confidence}`);

      // clean up memory
      input.dispose();
      prediction.dispose();

      return confidence;
    } catch (error) {
      console.error(`Prediction error: ${error}`);
      return 0;
    }
  }

  // save model
  async saveModel() {
    if (!this.model) {
      console.warn('No model to save');
      return;
    }

    try {
      const storageKey = `${STORAGE.CLASSIFIER}_${this.id}`;
      await this.model.save(`localstorage://${storageKey}`);

      // save tokenizer and config
      const tokenizerData = Array.from(this.tokenizer.entries());

      localStorage.setItem(`${STORAGE.TOKENIZER}_${this.id}`, JSON.stringify(tokenizerData));

      const config = {
        maxSequenceLength: this.maxSequenceLength,
        embeddingDim: this.embeddingDim,
        modelTrained: this.modelTrained,
        tokenizerSize: this.tokenizer.size
      };

      localStorage.setItem(`${STORAGE.CONFIG}_${this.id}`, JSON.stringify(config));

      // add to cache
      MODEL_CACHE.set(this.id, {
        model: this.model,
        tokenizer: new Map(this.tokenizer),
        config: { ...config },
        lastUsed: Date.now()
      });

      console.debug(`Model saved and cached successfully, tokenizer size: ${this.tokenizer.size}`);
    } catch (error) {
      console.error(`Failed to save model: ${error}`);
      throw error;
    }
  }

  // load model
  async loadModel(): Promise<boolean> {
    try {
      console.debug('Attempting to load model...');

      // first check cache
      const cached = MODEL_CACHE.get(this.id);
      if (cached) {
        console.debug(`Loading model from cache: ${this.id}`);
        this.model = cached.model;
        this.tokenizer = new Map(cached.tokenizer);
        this.maxSequenceLength = cached.config.maxSequenceLength;
        this.embeddingDim = cached.config.embeddingDim;
        this.modelTrained = cached.config.modelTrained;

        // update last used time
        cached.lastUsed = Date.now();
        return true;
      }

      // not in cache, load from localStorage
      // check if model data exists in localStorage
      const tokenizerData = localStorage.getItem(`${STORAGE.TOKENIZER}_${this.id}`);
      const configData = localStorage.getItem(`${STORAGE.CONFIG}_${this.id}`);

      if (!tokenizerData || !configData) {
        console.debug('No saved model data found in localStorage');
        return false;
      }

      // load TensorFlow model
      const storageKey = `${STORAGE.CLASSIFIER}_${this.id}`;
      this.model = await tf.loadLayersModel(`localstorage://${storageKey}`);
      console.debug('TensorFlow model loaded successfully');

      // restore tokenizer
      const tokenizerEntries = JSON.parse(tokenizerData);
      this.tokenizer = new Map(tokenizerEntries);
      console.debug(`Tokenizer restored, size: ${this.tokenizer.size}`);

      // restore config
      const config = JSON.parse(configData);
      this.maxSequenceLength = config.maxSequenceLength;
      this.embeddingDim = config.embeddingDim;
      this.modelTrained = config.modelTrained;

      console.debug(`Config restored - Max sequence length: ${this.maxSequenceLength}`);
      console.debug(`Config restored - Embedding dim: ${this.embeddingDim}`);
      console.debug(`Config restored - Model trained: ${this.modelTrained}`);

      // verify data integrity
      if (config.tokenizerSize && config.tokenizerSize !== this.tokenizer.size) {
        console.warn(`Tokenizer size mismatch: expected=${config.tokenizerSize}, actual=${this.tokenizer.size}`);
      }

      // add to cache
      MODEL_CACHE.set(this.id, {
        model: this.model,
        tokenizer: new Map(this.tokenizer),
        config: {
          maxSequenceLength: this.maxSequenceLength,
          embeddingDim: this.embeddingDim,
          modelTrained: this.modelTrained,
          tokenizerSize: this.tokenizer.size
        },
        lastUsed: Date.now()
      });

      // test if model works correctly
      const testTokens = Array.from(this.tokenizer.keys()).slice(0, 3);
      if (testTokens.length > 0) {
        console.debug(`Loaded tokenizer sample tokens: ${testTokens.join(', ')}`);
      }

      console.debug(`Model loaded and cached successfully: ${this.id}`);
      return true;
    } catch (error) {
      console.error(`Failed to load model: ${error}`);

      // clean up partially loaded data
      this.model = null;
      this.tokenizer.clear();
      this.modelTrained = false;

      return false;
    }
  }

  // debug method: check data and model status
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

  // validate training data format
  static validateTrainingData(data: string[] | string): string[] | null {
    let processedData: string[] = [];

    // process input data type
    if (typeof data === 'string') {
      // if string, split by newline
      processedData = data
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } else if (Array.isArray(data)) {
      // if array, use directly
      processedData = [...data];
    } else {
      console.error('Training data must be string or string array');
      return null;
    }

    // filter invalid text
    let validData = processedData.filter((item) => {
      if (!item || typeof item !== 'string' || item.trim().length === 0) {
        console.debug(`Filtering invalid text: ${item}`);
        return false;
      }
      return true;
    });

    // remove duplicate data
    validData = Array.from(new Set(validData));

    // check final sample count
    if (validData.length < 3) {
      console.error(`Training requires at least 3 positive samples, got ${validData.length} valid samples`);
      return null;
    }

    console.debug(`Training data validated: ${validData.length} positive samples`);
    return validData;
  }

  // get model detailed info (including storage size and vocabulary count)
  static getModelInfo(id: string): {
    sizeKB: number;
    vocabulary: number;
  } {
    let sizeKB = 0;
    let vocabulary = 0;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        // get vocabulary size
        const configKey = `${STORAGE.CONFIG}_${id}`;
        const configData = localStorage.getItem(configKey);
        if (configData) {
          const config = JSON.parse(configData);
          // vocabulary size is same as tokenizer size
          vocabulary = config.tokenizerSize || 0;
        }
        // calculate TensorFlow.js model file size
        let totalSize = 0;
        const modelPrefix = `tensorflowjs_models/${STORAGE.CLASSIFIER}_${id}`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(modelPrefix)) {
            const value = localStorage.getItem(key);
            if (value) {
              // calculate UTF-16 encoded byte size (JavaScript strings are UTF-16)
              totalSize += key.length * 2 + value.length * 2;
            }
          }
        }
        sizeKB = parseFloat((totalSize / 1024).toFixed(2));
      } catch (error) {
        console.error(`Failed to get model info: ${error}`);
      }
    }

    return { sizeKB, vocabulary };
  }

  // clear saved model data
  static clearSavedModel(id: string) {
    try {
      // remove from cache and clean up resources
      const cached = MODEL_CACHE.get(id);
      if (cached) {
        if (cached.model && typeof cached.model.dispose === 'function') {
          cached.model.dispose();
        }
        MODEL_CACHE.delete(id);
        console.debug(`Cleared model from cache: ${id}`);
      }

      localStorage.removeItem(`${STORAGE.CONFIG}_${id}`);
      localStorage.removeItem(`${STORAGE.TOKENIZER}_${id}`);

      // clear TensorFlow model
      if (typeof window !== 'undefined' && window.localStorage) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`tensorflowjs_models/${STORAGE.CLASSIFIER}_${id}`)) {
            keys.push(key);
          }
        }
        keys.forEach((key) => localStorage.removeItem(key));
      }

      console.debug('Cleared saved model data from localStorage');
    } catch (error) {
      console.error(`Failed to clear saved model: ${error}`);
    }
  }

  // clear saved model data of current instance
  clearSavedModel() {
    Classifier.clearSavedModel(this.id);
  }

  // static method: create classifier instance from cache
  static fromCache(id: string, cached: ModelCache): Classifier {
    const classifier = new Classifier(id);
    classifier.model = cached.model;
    classifier.tokenizer = new Map(cached.tokenizer);
    classifier.maxSequenceLength = cached.config.maxSequenceLength;
    classifier.embeddingDim = cached.config.embeddingDim;
    classifier.modelTrained = cached.config.modelTrained;
    return classifier;
  }
}

/**
 * Global prediction function.
 * Parameters are model ID and text, get model from cache map directly, or try to load from localStorage if not found.
 *
 * @param modelId - model ID
 * @param text - text to predict
 * @returns prediction result (positive class probability)
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
 */
export function cleanupCache(maxAge: number = 60 * 60 * 1000) {
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
}
