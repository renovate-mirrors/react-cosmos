// @flow

import { join, resolve } from 'path';
import { omit } from 'lodash';
import { silent as silentImport } from 'import-from';
import { getCosmosConfig } from 'react-cosmos-config';

import type { Config } from 'react-cosmos-flow/config';

/**
 * Enhance the user config to create the Loader config. Namely,
 * - Replace the entry and output
 * - Enable hot reloading
 * - Embed the user module require calls via embed-modules-webpack-loader
 * - Embed the playground options to use in the client-side bundle
 *
 * It's crucial for Cosmos to not depend on user-installed loaders. All
 * internal loaders and entries must have absolute path (via require.resolve)
 */
type Args = {
  webpack: Function,
  userWebpackConfig: Object,
  shouldExport?: boolean
};

export default function enhanceWebpackConfig({
  webpack,
  userWebpackConfig,
  shouldExport = false
}: Args) {
  const cosmosConfig: Config = getCosmosConfig();
  const {
    next,
    rootPath,
    containerQuerySelector,
    hot,
    publicUrl,
    webpack: webpackOverride
  } = cosmosConfig;

  let webpackConfig = userWebpackConfig;

  if (typeof webpackOverride === 'function') {
    console.log(`[Cosmos] Overriding webpack config`);
    webpackConfig = webpackOverride(webpackConfig, { env: getEnv() });
  }

  const entry = getEntry(cosmosConfig, shouldExport);
  const output = getOutput(cosmosConfig, shouldExport);

  const rules = [
    ...getExistingRules(webpackConfig),
    next
      ? {
          loader: require.resolve('./embed-modules-webpack-loader-next'),
          include: require.resolve('../../../client/user-modules-next')
        }
      : {
          loader: require.resolve('./embed-modules-webpack-loader'),
          include: require.resolve('../../../client/user-modules')
        }
  ];

  let plugins = [
    ...getExistingPlugins(webpackConfig),
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify(shouldExport ? 'production' : 'development'),
        PUBLIC_URL: JSON.stringify(removeTrailingSlash(publicUrl))
      }
    }),
    new webpack.DefinePlugin({
      COSMOS_CONFIG: JSON.stringify({
        // Config options that are available inside the client bundle. Warning:
        // Must be serializable!
        containerQuerySelector
      })
    }),
    getNoErrorsPlugin(webpack)
  ];

  if (!alreadyHasPlugin(webpackConfig, 'HtmlWebpackPlugin')) {
    const HtmlWebpackPlugin = silentImport(rootPath, 'html-webpack-plugin');

    if (HtmlWebpackPlugin) {
      plugins = [
        ...plugins,
        new HtmlWebpackPlugin({
          title: 'React Cosmos',
          filename: '_loader.html'
        })
      ];
    }
  }

  if (hot && !shouldExport) {
    if (!alreadyHasPlugin(webpackConfig, 'HotModuleReplacementPlugin')) {
      plugins = [...plugins, new webpack.HotModuleReplacementPlugin()];
    }
  }

  return {
    ...webpackConfig,
    entry,
    output,
    module: extendModuleWithRules(webpackConfig, rules),
    plugins
  };
}

function getEntry({ next, globalImports, hot }, shouldExport) {
  // The React devtools hook needs to be imported before any other module which
  // might import React
  let entry = [resolveClientPath('react-devtools-hook')];

  // Global imports are injected in the user modules file in Cosmos Next, to
  // make them hot reload-able
  if (!next) {
    entry = [...entry, ...globalImports];
  }

  if (hot && !shouldExport) {
    entry = [
      ...entry,
      `${require.resolve(
        'webpack-hot-middleware/client'
      )}?reload=true&overlay=false`
    ];
  }

  return [
    ...entry,
    resolveClientPath(next ? 'loader-entry-next' : 'loader-entry')
  ];
}

function resolveClientPath(p) {
  return require.resolve(`../../../client/${p}`);
}

function getOutput({ outputPath, publicUrl }, shouldExport) {
  const filename = '[name].js';

  if (shouldExport) {
    return {
      // Most paths are created using forward slashes regardless of the OS for
      // consistency, but this one needs to have backslashes on Windows!
      path: join(outputPath, publicUrl),
      filename,
      publicPath: publicUrl
    };
  }

  return {
    // Setting path to `/` in development (where files are saved in memory and
    // not on disk) is a weird required for old webpack versions
    path: '/',
    filename,
    publicPath: publicUrl,
    // Enable click-to-open source in react-error-overlay
    devtoolModuleFilenameTemplate: info =>
      resolve(info.absoluteResourcePath).replace(/\\/g, '/')
  };
}

function getWebpackRulesOptionName(webpackConfig) {
  // To support webpack 1 and 2 configuration formats, we use the one that
  // user passes
  return webpackConfig.module && webpackConfig.module.loaders
    ? 'loaders'
    : 'rules';
}

function getExistingRules(webpackConfig) {
  const webpackRulesOptionName = getWebpackRulesOptionName(webpackConfig);

  return webpackConfig.module && webpackConfig.module[webpackRulesOptionName]
    ? [...webpackConfig.module[webpackRulesOptionName]]
    : [];
}

function extendModuleWithRules(webpackConfig, rules) {
  const webpackRulesOptionName = getWebpackRulesOptionName(webpackConfig);

  return {
    ...omit(webpackConfig.module, 'rules', 'loaders'),
    [webpackRulesOptionName]: rules
  };
}

function getExistingPlugins(webpackConfig) {
  const plugins = webpackConfig.plugins ? [...webpackConfig.plugins] : [];

  return plugins.map(plugin =>
    isPluginType(plugin, 'HtmlWebpackPlugin')
      ? changeHtmlPluginFilename(plugin)
      : plugin
  );
}

function changeHtmlPluginFilename(htmlPlugin) {
  if (htmlPlugin.options.filename !== 'index.html') {
    return htmlPlugin;
  }

  return new htmlPlugin.constructor({
    ...htmlPlugin.options,
    filename: '_loader.html'
  });
}

function getNoErrorsPlugin(webpack) {
  // Important: Without this webpack tries to apply hot updates for broken
  // builds and results in duplicate React nodes attached
  // See https://github.com/webpack/webpack/issues/2117
  // Note: NoEmitOnErrorsPlugin replaced NoErrorsPlugin since webpack 2.x
  return webpack.NoEmitOnErrorsPlugin
    ? new webpack.NoEmitOnErrorsPlugin()
    : new webpack.NoErrorsPlugin();
}

function alreadyHasPlugin({ plugins }, pluginName) {
  return plugins && plugins.filter(p => isPluginType(p, pluginName)).length > 0;
}

function isPluginType(plugin, constructorName) {
  return plugin.constructor && plugin.constructor.name === constructorName;
}

function removeTrailingSlash(str) {
  return str.replace(/\/$/, '');
}

function getEnv() {
  return process.env.NODE_ENV || 'development';
}
