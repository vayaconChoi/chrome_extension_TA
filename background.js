//로그 기록 디버깅 용
console.log("[HateFilter] background service worker started");

// 지금은 로컬에서 FastAPI 서버를 8000 포트로 띄웠으니까 이 URL 사용
// 나중에 클라우드에 배포하면 이 값만 바꾸면 됨.
const API_URL = "http://127.0.0.1:8000/predict";

// 간단한 캐시: 같은 텍스트를 여러 번 서버에 보내지 않도록
// key: 댓글 텍스트, value: { label, score }
const cache = new Map();

/**
 * content script에서 메시지를 받는 리스너
 * message.type === "CLASSIFY_COMMENTS" 인 경우에만 처리
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLASSIFY_COMMENTS") {
    const comments = message.comments; // [{ id, text }, ...]

    classifyComments(comments)
      .then((results) => {
        sendResponse({ results }); // content.js 쪽으로 결과 전달
      })
      .catch((err) => {
        console.error("Classification error:", err);
        sendResponse({ error: true });
      });

    // 비동기 응답을 사용하겠다는 의미로 true 리턴
    return true;
  }
});

/**
 * comments: [{ id, text }]
 * →
 * 서버에 아직 안 보낸 텍스트만 모아서 /predict 호출
 * →
 * 각 댓글별 { id, label, score } 배열로 리턴
 */
async function classifyComments(comments) {
  const textsToQuery = [];
  const idxMap = []; // textsToQuery[i]가 comments의 몇 번째인지 저장

  comments.forEach((c, idx) => {
    const t = (c.text || "").trim();
    if (!t) return;
    if (cache.has(t)) return; // 이미 캐시에 있으면 서버 안 보냄

    textsToQuery.push(t);
    idxMap.push(idx);
  });

  // 1) 서버로 새 텍스트들만 보내기
  if (textsToQuery.length > 0) {
    const body = JSON.stringify({ texts: textsToQuery });

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body
    });

    if (!res.ok) {
      throw new Error("API not ok: " + res.status);
    }

    const data = await res.json();
    // data.labels[i], data.scores[i] 가 textsToQuery[i]에 대응

    data.labels.forEach((label, i) => {
      const text = textsToQuery[i];
      const score = Array.isArray(data.scores) ? data.scores[i] : 0;
      cache.set(text, { label, score });
    });
  }

  // 2) 원래 comments 배열 기준으로 결과 만들어서 리턴
  const results = comments.map((c) => {
    const t = (c.text || "").trim();
    if (!t || !cache.has(t)) {
      // 캐시에 없으면 비혐오(0)으로 취급 (또는 null로 둬도 됨)
      return { id: c.id, label: 0, score: 0 };
    }
    const { label, score } = cache.get(t);
    return { id: c.id, label, score };
  });

  return results;
}