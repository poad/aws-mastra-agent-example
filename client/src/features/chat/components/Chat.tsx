import { Component, createSignal, For, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { SolidMarkdown } from 'solid-markdown';
import sha256 from 'crypto-js/sha256';
import { MastraClient } from '@mastra/client-js';
import { parseDataStreamPart } from '@ai-sdk/ui-utils';

interface ChatMessage {
  id: number;
  type: 'system' | 'user';
  message: string;
  streaming?: boolean;
}

export const Chat: Component = () => {
  // 履歴を管理するstore
  const [history, setHistory] = createStore<ChatMessage[]>([]);

  // 現在の表示テキストと入力
  const [input, setInput] = createSignal('');

  // エラーメッセージ
  const [error, setError] = createSignal('');

  const [isLoading, setIsLoading] = createSignal(false);

  // スクロール用の参照
  let messagesContainerRef: HTMLDivElement | undefined;

  // スクロールを最下部に固定する関数
  function scrollToBottom() {
    if (messagesContainerRef) {
      messagesContainerRef.scrollTop = messagesContainerRef.scrollHeight;
    }
  };

  function addMessageAndScroll(message: ChatMessage) {
    setHistory((prev) => [
      ...prev,
      message,
    ]);
    scrollToBottom();
  }

  onMount(scrollToBottom);

  async function pipeStream(
    reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>,
    id: number,
    decoder: TextDecoder,
  ) {

    const { done, value } = await reader.read();
    if (done) {
      setHistory(prev =>
        prev.map(msg =>
          msg.id === id
            ? {
              ...msg,
              streaming: false,
            }
            : msg,
        ),
      );
      scrollToBottom();
      return;
    };

    const stream = decoder.decode(value, { stream: true })
      .split('\n')
      .filter(line => line !== '')
      .map(parseDataStreamPart)
      .filter(({type}) => type === 'text')
      .map(({value}) => value);
    const chunk = stream.length > 0 ? stream.reduce((acc, cur) => `${(acc ?? '')}${cur}`) : '';

    // リアルタイムでメッセージを更新
    setHistory(prev =>
      prev.map(msg =>
        msg.id === id
          ? {
            ...msg,
            message: msg.message + chunk,
            streaming: true,
          }
          : msg,
      ),
    );
    scrollToBottom();
    await pipeStream(reader, id, decoder);
  }


  // ストリーミングフェッチ関数
  async function fetchStreamingContent(input: string) {
    const body = JSON.stringify({ messages: [ input ] });
    const hash = sha256(body);
    const endpoint = import.meta.env.VITE_API_URL ?? '/agent';
    const client = new MastraClient({
      baseUrl: endpoint,
      headers: {
        'x-amz-content-sha256': hash.toString(),
      },
    });
    const agent = client.getAgent('weatherAgent');


    const response = await agent.stream({
      messages: [input],
    });

    if (!response.body) {
      throw new Error('ストリーミングに失敗');
    }

    setIsLoading(false);

    const lastAssistantMessageId = Math.max(
      ...history.map(m => m.id),
      0,
    );

    const assistantMessageId = lastAssistantMessageId + 1;

    // await response.processDataStream({
    //   onTextPart(value) {
    //     addMessageAndScroll({
    //       id: assistantMessageId,
    //       type: 'system',
    //       message: value,
    //     });
    //   },
    //   onFinishMessagePart(value) {

    //   }
    // });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // 空のシステムメッセージを追加
    addMessageAndScroll({
      id: assistantMessageId,
      type: 'system',
      message: '',
      streaming: true,
    });

    await pipeStream(reader, assistantMessageId, decoder);
  };

  async function handleSubmit() {
    const question = input().trim();
    if (!question) return;

    // 入力欄をクリア
    setInput('');

    const newMessageId = history.length > 0
      ? Math.max(...history.map(m => m.id)) + 1
      : 1;

    addMessageAndScroll({
      id: newMessageId,
      type: 'user',
      message: question,
    });

    try {
      setIsLoading(true);
      await fetchStreamingContent(question);
    } catch (e) {
      setError(() => e.toString());
      setIsLoading(false);
    }
  }

  return (
    <div id='container'>
      {/* 履歴リスト */}
      <div class="mt-4" id='history-container' ref={messagesContainerRef}>
        <For each={history}>
          {(item) => (
            <div class={`history history-${item.type}`}>
              <div class='role'>{item.type === 'user' ? 'あなた' : 'Agent'}</div>
              <div class='message'><SolidMarkdown children={item.message} /></div>
            </div>
          )}
        </For>
        <div class='loading'>
          {isLoading() ? '考え中...' : ''}
        </div>
        <Show when={error()}>
          <div class='error'>{error()}</div>
        </Show>
      </div>

      <div id='input-bar'>
        <input
          id='input-box'
          type="text"
          value={input()}
          onInput={(e) => setInput(e.target.value)}
          placeholder="質問を入力..."
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading()}
          id='send-button'
        >
          送信
        </button>
      </div>
    </div>
  );
};

// export default Chat;
