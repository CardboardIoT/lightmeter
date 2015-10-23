/*
  A super-simple static server to
  host UI files
*/

var express = require('express'),
    config  = require('config');

function serve(port) {
  port = port || 3000;
  var app = express();

  app.use(express.static('static'));

  // Serve configuration to front-end app
  app.get('/config.json', function (req, res) {
    res.json(config);
  });

  var server = app.listen(port, function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log('Static server listening at http://%s:%s', host, port);
  });
  return server;
}

// Export for other modules to use
module.exports = serve;

// If run directly from command line start server
if (require.main === module) {
  serve(process.env.PORT);
}
