"use strict";

import { hash, encrypt, decrypt, compose } from "../lib/utils";

/**
 * Functional mixin created by `functionalMixinFactory`
 * @callback functionalMixin
 * @param {Object} o Object to compose
 * @returns {Object} Composed object
 */

/**
 * Functional mixin factory - partial application - returns mixin function
 * @callback functionalMixinFactory
 * @param {*} mixinParams params for mixin function
 * @returns {functionalMixin}
 */

/**
 * Private key to access previous version of the model
 */
export const prevmodel = Symbol("prevModel");
/**
 * private key to acess validation config
 */
export const validations = Symbol("validations");
/**
 * Process mixin pre or post update
 */
export const mixinType = {
  pre: Symbol("pre"),
  post: Symbol("post"),
};

/**
 * Stored mixins - use private symbol as key to prevent overwrite
 */
export const mixinSets = {
  [mixinType.pre]: Symbol("preUpdateMixins"),
  [mixinType.post]: Symbol("postUpdateMixins"),
};

/**
 * Set of pre mixins
 */
const premixins = mixinSets[mixinType.pre];
/**
 * Set of post mixins
 */
const postmixins = mixinSets[mixinType.post];

/**
 * Apply any pre and post mixins and return the result.
 *
 * @param {*} model - current model
 * @param {*} changes - object containing changes
 * @returns {import('.').Model} updated model
 */
export function processUpdate(model, changes) {
  changes[prevmodel] = JSON.parse(JSON.stringify(model)); // keep history

  const updates = model[premixins]
    ? compose(...model[premixins].values())(changes)
    : changes;

  const updated = { ...model, ...updates };

  return model[postmixins]
    ? compose(...model[postmixins].values())(updated)
    : updated;
}

/**
 * Store mixins for execution on update
 * @param {mixinType} type
 * run before changes are applied or afterward
 * @param {*} o  Object containing changes to apply (pre)
 * or new object after changes have been applied (post)
 * @param {string} name `Function.name`
 * @param {functionalMixin} cb mixin function
 */
function updateMixins(type, o, name, cb) {
  if (!mixinSets[type]) {
    throw new Error("invalid mixin type");
  }

  const mixinSet = o[mixinSets[type]] || new Map();

  if (!mixinSet.has(name)) {
    mixinSet.set(name, cb());

    return {
      ...o,
      [mixinSets[type]]: mixinSet,
    };
  }
  return o;
}

/**
 * bitmask for identifying events
 */
const eventMask = {
  update: 1, //  0001 Update
  create: 1 << 1, //  0010 Create
  onload: 1 << 2, //  0100 Load
};

/**
 * Run validation functions enabled for a given event.
 * @param {*} model - the composed object
 * @param {*} changes - object containing changes
 * @param {Number} event - Indicates what event is occuring:
 * 1st bit turned on means update, 2nd bit create, 3rd load
 */
export function validateModel(model, changes, event) {
  changes[prevmodel] = JSON.parse(JSON.stringify(model)); // keep history

  // Run validations against changes (input)
  const updates = model[validations]
    .filter(v => v.pre & event)
    .map(v => model[v.name].apply(changes))
    .reduce((p, c) => ({ ...p, ...c }), changes);

  const updated = { ...model, ...updates };

  // Run validations against the changed object (output)
  return updated[validations]
    .filter(v => v.post & event)
    .map(v => updated[v.name]())
    .reduce((p, c) => ({ ...p, ...c }), updated);
}

/**
 * Enable validation to run on specific events.
 * @param {boolean} onUpdate - whether or not to run the validation on update.
 * Defaults to `true`.
 * @param {boolean} onCreate - whether or not to run the validation on create.
 * Defaults to `false`.
 * @param {boolean} onLoad - whether or not to run the validation when
 * the object is being loaded into memory after being deserialized.
 * Defaults to `false`.
 */
function enableEvent(onUpdate = true, onCreate = false, onLoad = false) {
  let enabled = 0;

  if (onUpdate) {
    enabled |= eventMask.update;
  }
  if (onCreate) {
    enabled |= eventMask.create;
  }
  if (onLoad) {
    enabled |= eventMask.onload;
  }

  return enabled;
}

/**
 * Add a validation function to be called for a given event.
 * @param {*} o - the composed object
 * @param {string} name - name of function to run
 * @param {number} pre - "pre" functions run against the object
 * containing the changes. Use the output of `enableEvent` here.
 * @param {number} post - "post" functions run against the target
 * object after the changes have been applied. Use the output
 * of `enableEvent` here.
 */
export function addValidation(o, name, pre, post) {
  const config = o[validations] || [];

  if (config.some(v => v.name === name)) {
    return o;
  }

  console.debug("adding validation", name, pre, post);

  return {
    ...o,
    validateModel,
    [validations]: [...config, { name, pre, post }],
  };
}

/**
 * Resolve keys:
 * if the value is any array, flatten it.
 * If the value is "*", return all keys of the object.
 * If the value is a function, execute it to get dynamic keys.
 * If the function returns an array, flatten it.
 * @param {*} o - Object to compose
 * @param  {Array<string | function(*):string>} propKeys -
 * Names (or functions that return names) of properties
 * @returns {string[]} list of (resolved) property keys
 */
function parseKeys(o, ...propKeys) {
  const keys = propKeys.flat().map(function (k) {
    if (typeof k === "function") return k(o);
    if (k === "*") return Object.keys(o);
    return k;
  });
  return keys.flat();
}

/**
 * Functional mixin that encrypts the properties specified in `propKeys`
 * @param  {Array<string | function(*):string>} propKeys -
 * Names (or functions that return names) of properties to encrypt
 * @returns {functionalMixin} mixin function
 */
export const encryptProperties = (...propKeys) => o => {
  const keys = parseKeys(o, ...propKeys);

  const encryptProps = obj => {
    return keys
      .map(key => (obj[key] ? { [key]: encrypt(obj[key]) } : {}))
      .reduce((p, c) => ({ ...p, ...c }));
  };

  return {
    encryptProperties() {
      return encryptProps(this);
    },
    ...addValidation(
      o,
      encryptProperties.name,
      enableEvent(true, false),
      enableEvent(false, true)
    ),
    decrypt() {
      return keys
        .map(key => (this[key] ? { [key]: decrypt(this[key]) } : {}))
        .reduce((p, c) => ({ ...p, ...c }));
    },
  };
};

/**
 * Functional mixin that prevents properties from being updated.
 * Accepts a property name or a function that returns a property name.
 * @param  {Array<string | function(*):string>} propKeys - names of properties to freeze
 */
export const freezeProperties = (...propKeys) => o => {
  const preventUpdates = obj => {
    const keys = parseKeys(obj, ...propKeys);

    const mutations = Object.keys(obj).filter(key => keys.includes(key));
    if (mutations?.length > 0) {
      throw new Error(`cannot update readonly properties: ${mutations}`);
    }
  };

  return {
    freezeProperties() {
      preventUpdates(this);
    },
    ...addValidation(o, freezeProperties.name, enableEvent(), 0),
  };
};

/**
 * Functional mixin that enforces required fields
 * @param {Array<string | function(*):string>} propKeys -
 * required property names
 */
export const requireProperties = (...propKeys) => o => {
  const keys = parseKeys(o, ...propKeys);

  function requireProps(obj) {
    const missing = keys.filter(key => key && !obj[key]);
    if (missing?.length > 0) {
      throw new Error(`missing required properties: ${missing}`);
    }
  }
  return {
    requireProperties() {
      requireProps(this);
    },
    ...addValidation(o, requireProperties.name, 0, enableEvent()),
  };
};

/**
 * Functional mixin that hashes passwords
 * @param {*} hash hash algorithm
 * @param  {Array<string | function(*):string>} propKeys name of password props
 */
export const hashPasswords = (...propKeys) => o => {
  const keys = parseKeys(o, ...propKeys);

  function hashPwds(obj) {
    return keys
      .map(key => (obj[key] ? { [key]: hash(obj[key]) } : {}))
      .reduce((p, c) => ({ ...p, ...c }));
  }

  return {
    hashPasswords() {
      return hashPwds(this);
    },
    ...addValidation(
      o,
      hashPasswords.name,
      enableEvent(),
      enableEvent(false, true)
    ),
  };
};

const internalPropList = ["decrypt"];

/**
 *
 * @param  {...any} propKeys
 */
export const allowProperties = (...propKeys) => o => {
  function rejectUnknownProps() {
    const keys = parseKeys(o, ...propKeys);

    const allowList = keys.concat(internalPropList);
    const unknownProps = Object.keys(o).filter(key => !allowList.includes(key));

    if (unknownProps?.length > 0) {
      throw new Error(`invalid properties: ${unknownProps}`);
    }
  }

  return {
    rejectUnknownProperties() {
      return rejectUnknownProps(this);
    },
    ...addValidation(o, "rejectUnknownProperties", enableEvents(), 0),
  };
};

export const callMethod = (fn, ...args) => o => {
  return {
    ...o,
    ...o[fn](...args),
  };
};

/**
 * Test regular expressions
 */
export const RegEx = {
  email: /^(.+)@(.+){2,}\.(.+){2,}$/,
  ipv4Address: /^([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])$/,
  ipv6Address: /^((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4}))*::((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4}))*|((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4})){7}$/,
  phone: /^[1-9]\d{2}-\d{3}-\d{4}/,
  creditCard: /^(?:4[0-9]{12}(?:[0-9]{3})?|[25][1-7][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})$/,
  ssn: /^(?!666|000|9\\d{2})\\d{3}-(?!00)\\d{2}-(?!0{4})\\d{4}$/,
  /**
   *
   * @param {regexType} expr
   * @param {*} val
   */
  test(expr, val) {
    const _expr =
      Object.keys(this).includes(expr) && this[expr] instanceof RegExp
        ? this[expr]
        : expr;
    return _expr.test(val);
  },
};

/**
 * @callback isValid
 * @param {Object} o - the property owner
 * @param {*} propVal - the property value
 * @returns {boolean} - true if valid
 *
 * @typedef {'email'|'phone'|'ipv4Address'|'ipv6Address'|'creditCard'|'ssn'|RegExp} regexType
 *
 * @typedef {{
 *  propKey:string,
 *  isValid?:isValid,
 *  values?:any[],
 *  regex?:regexType,
 *  maxlen?:number
 *  maxnum?:number
 *  typeof?:string
 * }} validation
 */

/**
 * Run validation tests
 */
const Validator = {
  tests: {
    isValid: (v, o, propVal) => v(o, propVal),
    values: (v, o, propVal) => v.includes(propVal),
    regex: (v, o, propVal) => RegEx.test(v, propVal),
    typeof: (v, o, propVal) => v === typeof propVal,
    maxnum: (v, o, propVal) => v + 1 > propVal,
    maxlen: (v, o, propVal) => v + 1 > propVal.length,
  },
  /**
   * Returns true if tests pass
   * @param {validation} v validation spec
   * @param {Object} o object to compose
   * @param {*} propVal value of property to validate
   * @returns {boolean} true if tests pass
   */
  isValid(v, o, propVal) {
    return Object.keys(this.tests).every(key => {
      if (v[key]) {
        // enabled
        return this.tests[key](v[key], o, propVal);
      }
      return true;
    });
  },
};

/**
 *
 * @param {validation[]} validations
 */
export const validateProperties = validations => o => {
  function validate(obj) {
    const invalid = validations.filter(v => {
      const propVal = obj[v.propKey];

      if (!propVal) {
        return false;
      }
      return !Validator.isValid(v, obj, propVal);
    });

    if (invalid?.length > 0) {
      throw new Error(`invalid value for ${[...invalid.map(v => v.propKey)]}`);
    }
  }

  return {
    validateProperties() {
      validate(this);
    },
    ...addValidation(
      o,
      validateProperties.name,
      enableEvent(true, true),
      enableEvent(true, true)
    ),
  };
};

/**
 * @callback updaterFn
 * @param {Object} o
 * @param  {*} propVal
 * @returns {Object} object with updated properties
 *
 * @typedef {{
 * propKey: string,
 * update: updaterFn
 * }} updater
 */

/**
 * @param {updater[]} updaters
 */
export const updateProperties = updaters => o => {
  function updateProps(obj) {
    const updates = updaters.filter(u => obj[u.propKey]);

    if (updates?.length > 0) {
      return updates
        .map(u => u.update(o, obj[u.propKey]))
        .reduce((p, c) => ({ ...p, ...c }));
    }
  }

  return {
    updateProperties() {
      return updateProps(this);
    },
    ...addValidation(o, updateProperties.name, enableEvent(), enableEvent()),
  };
};

/**
 * Check the value of the property before returning its key.
 * @param {*} propKey
 * @param {regexType} expr
 * @returns {function(any):any} dynamic property func
 */
export const withValidFormat = (propKey, expr) => o => {
  if (o.isLoading) return propKey;
  if (o[propKey] && !RegEx.test(expr, o[propKey])) {
    throw new Error(`invalid ${propKey}`);
  }
  return propKey;
};

/**
 *
 * @param {string} value
 * @param {regexType} expr
 */
export const checkFormat = (value, expr) => {
  if (value && !RegEx.test(expr, value)) {
    const x = expr instanceof RegExp ? value : expr;
    throw new Error(`${x} invalid`);
  }
};

/**
 * Implement GDPR encryption requirement across models
 */
export const encryptPersonalInfo = encryptProperties(
  "lastName",
  "address",
  "shippingAddress",
  "billingAddress",
  "email",
  "phone",
  "mobile",
  "creditCardNumber",
  "ssn"
);
// withValidFormat("email", "email"),
// withValidFormat("phone", "phone"),
// withValidFormat("mobile", "phone"),
// withValidFormat("creditCardNumber", "creditCard"),
// withValidFormat("ssn", "ssn")

/**
 * Global mixins
 */
const GlobalMixins = [encryptPersonalInfo];

export default GlobalMixins;
