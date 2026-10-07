import path from 'node:path';
import type { Configuration } from 'webpack';

export const rendererConfig: Configuration = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader', options: { transpileOnly: true } }],
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      {
        test: /\.(?:png|svg)$/i,
        type: 'asset/resource',
        generator: { filename: 'main_window/assets/[name][ext]' },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
    extensionAlias: { '.js': ['.js', '.ts', '.tsx'] },
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  target: 'web',
};
