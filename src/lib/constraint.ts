import { alert } from '$lib/components';
import type { EventHandler } from 'svelte/elements';

/**
 * Constraint types applicable to form input.
 */
export type Constraint = Partial<{
  value: any; // eslint-disable-line
  name: string;
  type: string;
  required: boolean;
  autocomplete: AutoFill;
  min: string | number;
  max: string | number;
  step: string | number;
  minlength: number;
  maxlength: number;
  pattern: string;
  oninvalid: EventHandler<Event>;
}>;

/**
 * Type of constraint builder.
 */
export type ConstraintBuilder =
  StringConstraintBuilder | PatternConstraintBuilder | NumberConstraintBuilder | DatetimeConstraintBuilder;

/**
 * Abstract class of constraint builder.
 */
abstract class AbstractConstraintBuilder<T> {
  protected constraint: Constraint = {
    required: true
  };

  required(required: boolean): this {
    this.constraint.required = required;
    return this;
  }

  autocomplete(autocomplete: AutoFill): this {
    this.constraint.autocomplete = autocomplete;
    return this;
  }

  value(value: T): this {
    this.constraint.value = value;
    return this;
  }

  oninvalid(oninvalid: string | EventHandler<Event>): this {
    if (typeof oninvalid === 'string') {
      const message = oninvalid;
      oninvalid = () => alert({ level: 'error', message: message });
    }
    this.constraint.oninvalid = oninvalid;
    return this;
  }

  build(name: string): Constraint {
    this.constraint.name = name;
    return this.constraint;
  }
}

/**
 * Builder for string constraint.
 */
class StringConstraintBuilder extends AbstractConstraintBuilder<string> {
  minlength(minlength: number): this {
    this.constraint.minlength = minlength;
    return this;
  }

  maxlength(maxlength: number): this {
    this.constraint.maxlength = maxlength;
    return this;
  }
}

/**
 * Builder for string constraint with pattern.
 */
class PatternConstraintBuilder extends StringConstraintBuilder {
  constructor(type: string) {
    super();
    this.constraint.type = type;
  }

  pattern(pattern: string): this {
    this.constraint.pattern = pattern;
    return this;
  }
}

/**
 * Builder for number constraint.
 */
class NumberConstraintBuilder extends AbstractConstraintBuilder<number> {
  constructor(type: string) {
    super();
    this.constraint.type = type;
  }

  min(min: number): this {
    this.constraint.min = min;
    return this;
  }

  max(max: number): this {
    this.constraint.max = max;
    return this;
  }

  step(step: number): this {
    this.constraint.step = step;
    return this;
  }
}

/**
 * Builder for datetime constraint.
 */
class DatetimeConstraintBuilder extends AbstractConstraintBuilder<string> {
  constructor(type: string) {
    super();
    this.constraint.type = type;
  }

  min(min: string): this {
    this.constraint.min = min;
    return this;
  }

  max(max: string): this {
    this.constraint.max = max;
    return this;
  }

  step(step: number | 'any'): this {
    this.constraint.step = step;
    return this;
  }
}

/**
 * Mapping of constraint builder factories.
 */
const constraintBuilderFactories = {
  // textarea element
  textarea: () => new StringConstraintBuilder(),
  // input element with type text, url, email, password
  text: () => new PatternConstraintBuilder('text'),
  url: () => new PatternConstraintBuilder('url'),
  email: () => new PatternConstraintBuilder('email'),
  password: () => new PatternConstraintBuilder('password'),
  // input element with type number, range
  number: () => new NumberConstraintBuilder('number'),
  range: () => new NumberConstraintBuilder('range'),
  // input element with type datetime-local, date, time, week, month
  datetime: () => new DatetimeConstraintBuilder('datetime-local'),
  date: () => new DatetimeConstraintBuilder('date'),
  time: () => new DatetimeConstraintBuilder('time'),
  week: () => new DatetimeConstraintBuilder('week'),
  month: () => new DatetimeConstraintBuilder('month')
};

/**
 * Create a form schema with constraints.
 *
 * @param use - function to select and configure constraint builders from the factory
 * @returns created form schema
 */
export function buildFormSchema<T extends Record<string, ConstraintBuilder>>(
  use: (arg: typeof constraintBuilderFactories) => T
): { [K in keyof T]: Constraint } {
  const builders = use(constraintBuilderFactories);
  const constraints = Object.entries(builders).map(([key, builder]) => [key, builder.build(key)]);
  return Object.fromEntries(constraints);
}
