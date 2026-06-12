import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
