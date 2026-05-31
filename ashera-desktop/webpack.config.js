module.exports = {
  entry: './app/index.jsx',
  output: { path: __dirname + '/app', filename: 'bundle.js' },
  module: { rules: [{ test: /\.jsx?$/, use: 'babel-loader', exclude: /node_modules/ }] },
  resolve: { extensions: ['.js', '.jsx'] }
}
