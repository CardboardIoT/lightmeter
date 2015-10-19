module.exports = {
  "postcss-import": {
    onImport: function(sources) {
      console.log('Last processed ' + new Date());
      global.watchCSS(sources);
    }
  }
};