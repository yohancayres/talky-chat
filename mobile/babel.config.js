module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 usa o worklets; o plugin TEM que ser o último da lista.
    plugins: ['react-native-worklets/plugin'],
  };
};
