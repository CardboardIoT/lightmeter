/*
  A super-simple static server to
  host UI files
*/

var express = require('express'),
    config  = require('config');

var app = express();

app.use(express.static('static'));

// Serve configuration to front-end app
app.get('/config.json', function (req, res) {
  res.json(config);
});

var server = app.listen(process.env.PORT || 3000, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('Static server listening at http://%s:%s', host, port);
});
