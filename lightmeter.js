#!/usr/bin/env node

/*
  A super-simple static server to
  host UI files
*/

var browserify = require('browserify-middleware'),
    express = require('express');

function serve(port, entryPoint, opts) {
  opts = opts || { quiet: false }

  var app = express();

  app.get('/bundle.js', browserify(entryPoint, {
    transform: [
      require("brfs"),
      require("babelify"),
      require("envify")
    ]
  }));

  app.use(express.static(__dirname + '/static'));

  var server = app.listen(port, function () {
    var host = server.address().address;
    var port = server.address().port;

    if (opts.quiet === false) {
      console.log('\nVisit http://localhost:' + port + ' in your browser to view your UI');
      console.log('Press Ctl+C to stop the server');
    }
  });
  return server;
}

// Export for other modules to use
module.exports = serve;

// If run directly from command line start server
if (require.main === module) {
  var args = require('minimist')(process.argv, {
    boolean: 'help',
    alias: { 'h': 'help' }
  });

  if (args.help) {
    console.log('lightmeter [--port PORT] <entry script>');
    console.log('\n  Starts a local webserver to serve lightmeter widget\n');
    process.exit();
  }

  var entryPoint = args._[2] ||  __dirname + '/static/src/main.js',
      port = args.port || process.env.PORT || 3000;

  serve(port, entryPoint);
}
