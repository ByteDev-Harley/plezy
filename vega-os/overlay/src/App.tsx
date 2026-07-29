import * as React from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import {WebView} from '@amazon-devices/webview';

const ENTRYPOINT = 'file:///pkg/assets/index.html';

export const App = () => {
  const [loadError, setLoadError] = React.useState('');

  const handleMessage = React.useCallback((event: any) => {
    try {
      const message = JSON.parse(String(event.nativeEvent.data || ''));
      if (message.type === 'exit-app') {
        BackHandler.exitApp();
      }
    } catch (error) {
      console.warn('Ignoring malformed Plezy WebView message', error);
    }
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        style={styles.webView}
        source={{uri: ENTRYPOINT}}
        hasTVPreferredFocus={true}
        allowFileAccess={true}
        allowSystemKeyEvents={true}
        javaScriptEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        onMessage={handleMessage}
        onLoad={() => setLoadError('')}
        onError={(event: any) => {
          const description = String(event.nativeEvent.description || 'Unknown WebView error');
          console.error('Plezy WebView failed to load:', description);
          setLoadError(description);
        }}
      />
      {loadError ? (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>Plezy could not start</Text>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080b13',
  },
  webView: {
    flex: 1,
    backgroundColor: '#080b13',
  },
  error: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 80,
    backgroundColor: '#080b13',
  },
  errorTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 14,
  },
  errorText: {
    color: '#c2c9d6',
    fontSize: 20,
    textAlign: 'center',
  },
});
