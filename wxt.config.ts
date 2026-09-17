import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'AI Video Tutor',
    description:
      'A 1-on-1 AI learning assistant that sits beside the video you are watching.',
    // Keep this list minimal: the content script is declared in the manifest
    // by WXT rather than injected at runtime, so `scripting` is not needed, and
    // every browser.tabs.* call works off `<all_urls>` + `activeTab` alone.
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
    homepage_url: 'https://github.com/luvchippy/AI-Video-Tutor',
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
    action: {
      default_title: 'AI Video Tutor',
    },
  },
});
