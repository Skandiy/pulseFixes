import { createApp, type App as VueApp } from 'vue';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import App from './App.vue';
import VAlert from './components/VAlert.vue';
import VIcon from './components/VIcon.vue';
import VMenu from './components/VMenu.vue';
import VTextField from './components/VTextField.vue';
import './styles/event-planning.css';

let app: VueApp<Element> | null = null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

export function mount(root: HTMLElement): void {
  if (app) {
    return;
  }

  app = createApp(App);
  app.component('VAlert', VAlert);
  app.component('VIcon', VIcon);
  app.component('VMenu', VMenu);
  app.component('VTextField', VTextField);
  app.use(VueQueryPlugin, { queryClient });
  app.mount(root);
}

export function unmount(): void {
  if (!app) {
    return;
  }

  app.unmount();
  app = null;
}

declare global {
  interface Window {
    TrickPlusEventPlanning?: {
      mount: typeof mount;
      unmount: typeof unmount;
    };
  }
}

window.TrickPlusEventPlanning = {
  mount,
  unmount
};
