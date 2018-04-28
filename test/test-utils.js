exports.promiseTimeout = function(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

exports.eitherPromise = function(...promises) {
  return new Promise((resolve, reject) => {
    function sendResolve(value) {
      if (resolve) {
        resolve(value);
        resolve = null;
      }
    }
    function sendReject(error) {
      if (reject) {
        reject(error);
        reject = null;
      }
    }
    for (let promise of promises) {
      promise.then(sendResolve).catch(sendReject);
    }
  });
};
