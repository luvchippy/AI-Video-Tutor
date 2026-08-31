import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'AI Video Tutor',
    description:
      'A 1-on-1 AI learning assistant that sits beside the video you are watching.',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'AI Video Tutor',
    },
  },
});
