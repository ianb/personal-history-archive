exports.sendError = function(error, res) {
  let errString = `Error: ${error}`;
  if (error.stack) {
    errString += `\n${error.stack}`;
  }
  res.status(500).type("text").send(errString);
  console.error(errString);
};
