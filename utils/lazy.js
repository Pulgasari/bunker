// @bunker/utils/lazy.js

// defers a factory until the first call and remembers what it returned. the factory
// runs once even when it returns undefined, which is what separates this from `??=`.
export const lazy = (factory) => {
  let called = false;
  let value;

  const resolve = () => {
    if (!called) {
      called = true;
      value  = factory();
    }
    return value;
  };

  resolve.clear = () => { called = false; value = undefined; };
  return resolve;
};

export default lazy;
