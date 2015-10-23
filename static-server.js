/*
  A super-simple static server to
  host UI files
*/

var browserify = require('browserify-middleware'),
    express = require('express');

function serve(port, entryPoint, opts) {
  opts = opts || { quiet: false }

  var app = express();

  app.get('/bundle.js', browserify(entryPoint));

  app.use(express.static(__dirname + '/static'));

  var server = app.listen(port, function () {
    var host = server.address().address;
    var port = server.address().port;

    if (opts.quiet === false) {
      console.log('Static server listening at http://%s:%s', host, port);
    }
  });
  return server;
}

// Export for other modules to use
module.exports = serve;

// If run directly from command line start server
if (require.main === module) {
  serve(process.env.PORT || 3000, './static/src/main.js');
}
