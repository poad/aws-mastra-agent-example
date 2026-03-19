import { Chat } from './features/chat/components/Chat';
import { Suspense, type Component } from 'solid-js';

import './app.css';

const App: Component = (props?: { children: Element }) => {

  return (
    <>
      <Chat />

      <main>
        <Suspense>{props?.children}</Suspense>
      </main>
    </>
  );
};

export default App;
