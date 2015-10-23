/*
  A super-simple static server to
  host UI files
*/

var beefy = require('beefy'),
    http = require('http');

function serve(port) {
  var handler = beefy({
    entries: ['static/src/main.js'],
    bundler: 'watchify',
    bundlerFlags: ['-t', 'brfs'],
    cwd: __dirname + '/static'
  });
  http.createServer(handler).listen(port);
}

// Export for other modules to use
module.exports = serve;

// If run directly from command line start server
if (require.main === module) {
  serve(process.env.PORT);
}
