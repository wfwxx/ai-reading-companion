"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Result = {
  title?: string;
  text?: string;
  illustration?: string;
  mode?: string;
  pageSummary?: string;
  response?: string;
  needsClarification?: boolean;
  error?: string;
  detail?: string;
  needsSetup?: boolean;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const autoRef = useRef(true);
  const priorHashRef = useRef("");
  const stableCountRef = useRef(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [autoRead, setAutoRead] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("准备开始陪读");
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState("");
  const [context, setContext] = useState("");
  const [lastFrame, setLastFrame] = useState<string>("");
  const [result, setResult] = useState<Result>({});

  useEffect(() => {
    autoRef.current = autoRead;
  }, [autoRead]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeech = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const analyzeFrame = useCallback(async (frame: string, voiceQuestion = "") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus("正在识别书页和插图...");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame, question: voiceQuestion, context }),
      });
      const data: Result = await response.json();
      setResult(data);

      if (data.error) {
        setStatus(data.needsSetup ? "需要配置 AI 密钥" : data.error);
        if (data.needsSetup) {
          speak("还需要配置 AI 密钥才能识别页面。请在部署环境中设置 OpenAI API Key。");
        }
        return;
      }

      const nextContext = [
        context,
        data.text ? `页面文字：${data.text}` : "",
        data.illustration ? `插图：${data.illustration}` : "",
      ].filter(Boolean).join("\n").slice(-8000);
      setContext(nextContext);

      setStatus(data.needsClarification ? "识别信息需要补充确认" : "已识别当前页面");
      if (data.response) speak(data.response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络或服务错误";
      setStatus(`识别失败：${message}`);
      setResult({ error: message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [context, speak]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", 0.82);

    const small = document.createElement("canvas");
    small.width = 24;
    small.height = 24;
    const smallCtx = small.getContext("2d");
    if (!smallCtx) return frame;
    smallCtx.drawImage(canvas, 0, 0, 24, 24);
    const pixels = smallCtx.getImageData(0, 0, 24, 24).data;
    let hash = "";
    for (let i = 0; i < pixels.length; i += 16) {
      hash += String.fromCharCode(pixels[i] >> 3, pixels[i + 1] >> 3, pixels[i + 2] >> 3);
    }

    let distance = 0;
    const prior = priorHashRef.current;
    if (prior) {
      const length = Math.min(prior.length, hash.length);
      for (let i = 0; i < length; i++) {
        distance += Math.abs(prior.charCodeAt(i) - hash.charCodeAt(i));
      }
    }

    if (!prior || distance < 3) {
      stableCountRef.current += 1;
    } else {
      stableCountRef.current = 1;
    }
    priorHashRef.current = hash;

    if (stableCountRef.current >= 6 && autoRef.current) {
      stableCountRef.current = 0;
      setLastFrame(frame);
      void analyzeFrame(frame);
    }

    return frame;
  }, [analyzeFrame]);

  useEffect(() => {
    if (!cameraOn) return;
    timerRef.current = window.setInterval(() => captureFrame(), 400);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [cameraOn, captureFrame]);

  const startCamera = async () => {
    try {
      stopSpeech();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setStatus("请把书页放稳，系统会自动识别");
    } catch (error) {
      setStatus("无法打开摄像头，请检查浏览器权限");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
    setStatus("摄像头已关闭");
  };

  const recognizeNow = () => {
    const frame = captureFrame();
    if (!frame) {
      setStatus("摄像头尚未准备好");
      return;
    }
    setLastFrame(frame);
    void analyzeFrame(frame, question);
  };

  const startListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("当前浏览器不支持语音识别，可使用下方文字提问");
      return;
    }

    stopSpeech();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";
    recognition.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setTranscript(text);
      setQuestion(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setStatus("没有听清，请再说一次或输入文字");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setStatus("正在听，请说出你的问题...");
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const submitQuestion = () => {
    const frame = captureFrame();
    if (!frame) {
      setStatus("请先打开摄像头");
      return;
    }
    setLastFrame(frame);
    void analyzeFrame(frame, question);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>AI 实时陪读</h1>
          <p>{status}</p>
        </div>
        <div className="actions">
          {cameraOn ? (
            <button className="button secondary" onClick={stopCamera}>关闭摄像头</button>
          ) : (
            <button className="button" onClick={startCamera}>开启陪读</button>
          )}
        </div>
      </header>

      <section className="layout">
        <div className="videoCard">
          <video ref={videoRef} muted playsInline />
          <canvas ref={canvasRef} hidden />

          {lastFrame && <img className="thumbnail" src={lastFrame} alt="最近识别的书页" />}

          <div className="videoControls">
            <button className="round" onClick={listening ? stopListening : startListening} aria-label="语音提问">
              {listening ? "■" : "🎙"}
            </button>
            <button className="round" onClick={speaking ? stopSpeech : recognizeNow} aria-label="朗读或识别">
              {speaking ? "Ⅱ" : "▸"}
            </button>
          </div>

          <label className="autoToggle">
            <input type="checkbox" checked={autoRead} onChange={(event) => setAutoRead(event.target.checked)} />
            页面稳定后自动识别
          </label>
        </div>

        <aside className="panel">
          <div className="tabs">
            <span className="active">陪读结果</span>
            <span>上下文已保留 {context.length} 字</span>
          </div>

          {busy && <div className="busy">正在理解这一页...</div>}

          {result.response ? (
            <article className="answer">
              {result.title && <h2>{result.title}</h2>}
              {result.pageSummary && <p className="summary">{result.pageSummary}</p>}
              <p>{result.response}</p>
              {result.illustration && <div className="note"><strong>画面观察：</strong>{result.illustration}</div>}
              {result.needsClarification && <div className="warning">部分文字或条件可能识别不完整，请补拍清晰页面。</div>}
            </article>
          ) : result.error ? (
            <article className="empty errorBox">
              <h2>暂时无法完成</h2>
              <p>{result.error}</p>
              {result.detail && <small>{result.detail}</small>}
            </article>
          ) : (
            <article className="empty">
              <div className="bookIcon">📖</div>
              <h2>把书放到镜头前</h2>
              <p>页面稳定后会自动识别。你也可以随时按麦克风提问。</p>
            </article>
          )}

          {result.text && (
            <details>
              <summary>查看识别到的文字</summary>
              <p className="rawText">{result.text}</p>
            </details>
          )}

          <div className="askBox">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitQuestion();
              }}
              placeholder={transcript ? `听到：${transcript}` : "问这一页、换一个讲法或帮我解题..."}
            />
            <button className="send" onClick={submitQuestion} disabled={busy}>发送</button>
          </div>
        </aside>
      </section>
    </main>
  );
}
