const { listPageUrls, readPage } = require("./json-files");

let argv = require("yargs")
  .usage("$0 <cmd> args")
  .command("run --job NAME ./some-script", "Run a script over all pages", (yargs) => {
    yargs.positional("script", {
      type: "string",
      demandOption: true,
      describe: "The script to run (can contain arguments, like './some-script --extra-option')"
    });
    yargs.option("job", {
      alias: "j",
      type: "string"
    });
  })
  .argv
  .help();

console.log("argv", argv);
