const path = require('path');

module.exports = {
  // Set the mode to development or production
  mode: 'production',
  
  // Entry point of your application
  entry: './src/index.js',
  
  // Output configuration
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  
  // Enable source maps for debugging
  devtool: 'source-map',
  
  // Configure module resolution
  resolve: {
    // Add aliases to use browser versions of Firebase modules
    alias: {
      '@firebase/auth': path.resolve(__dirname, 'node_modules/@firebase/auth/dist/esm2017', 'index.js'),
      '@firebase/app': path.resolve(__dirname, 'node_modules/@firebase/app/dist/esm', 'index.esm2017.js'),
    },
    // Add file extensions to resolve
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.cjs']
  },
  
  // Configure module loaders
  module: {
    rules: [
      {
        // Process JavaScript files with Babel
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  },
  
  // Configure target environment
  target: 'electron-renderer'
};
