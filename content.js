// 디버깅 용 로그 기록 확인 
console.log("[HateFilter] content script loaded");


// =========================
// 1) 유튜브 댓글 DOM 찾기
// =========================

// 유튜브 댓글 텍스트 셀렉터 후보
const COMMENT_TEXT_SELECTORS = [
  "ytd-comment-renderer #content-text",
  "yt-attributed-string#content-text" // 신규 UI 대비
];

// id -> { text, container }
const commentMap = new Map();

// 아직 서버에 보내지 않은 댓글들
let pendingComments = [];

// API 호출을 너무 자주 하지 않게 디바운스용 타이머
let classifyTimer = null;


// ==============================
// 2) 페이지에서 댓글 스캔 함수
// ==============================

function scanComments() {
    //디버깅용 로그
    console.log("[HateFilter] scanComments called");
  const elements = [];

  // 셀렉터들로 댓글 텍스트 DOM 모으기
  COMMENT_TEXT_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => elements.push(el));
  });

  for (const el of elements) {
    // 이미 처리한 댓글이면 패스
    if (el.dataset.__mlChecked === "1") continue;
    el.dataset.__mlChecked = "1";

    const text = (el.textContent || "").trim();
    if (!text) continue;

    // 댓글 전체 박스 (숨길 대상)
    const container =
      el.closest("ytd-comment-thread-renderer, ytd-comment-renderer") || el;

    // 간단한 임시 ID 생성 (텍스트 + 인덱스 기반)
    const id = makeCommentId(text, commentMap.size);

    commentMap.set(id, { text, container });

    // 분류 요청 배치에 추가
    pendingComments.push({ id, text });
  }

  scheduleClassification();
}

function makeCommentId(text, idx) {
  return `${idx}_${text.slice(0, 30)}`;
}


// ====================================
// 3) 일정 시간 모아서 한 번에 분류 요청
// ====================================

function scheduleClassification() {
    //디버깅용 로그
    if (pendingComments.length === 0) {
    console.log("[HateFilter] scheduleClassification: no pending comments");
    return;
  }

  console.log("[HateFilter] scheduleClassification: pending =", pendingComments.length);
  if (pendingComments.length === 0) return;

  // 이미 타이머 있으면 리셋
  if (classifyTimer) clearTimeout(classifyTimer);

  // 500ms 안에 모인 댓글들을 한 번에 서버로 보내기
  classifyTimer = setTimeout(() => {
    const batch = pendingComments;
    pendingComments = [];
    classifyTimer = null;

    classifyBatch(batch);
  }, 500);
}


// =================================
// 4) background.js 에게 분류 요청
// =================================

function classifyBatch(batch) {
    //디버깅용 로그
    console.log("[HateFilter] classifyBatch sending to background:", batch.length);
  // chrome.runtime.sendMessage로 background.js에 메시지 전송
  chrome.runtime.sendMessage(
    {
      type: "CLASSIFY_COMMENTS",
      comments: batch // [{ id, text }]
    },
    (response) => {
      if (!response || response.error) {
        console.error("[HateFilter] classification failed", response);
        return;
      }

      applyClassification(response.results);
    }
  );
}


// ======================================
// 5) 분류 결과 받아서 혐오 댓글 숨기기
// ======================================

function applyClassification(results) {
  results.forEach((r) => {
    const { id, label } = r; // label: 1 = 혐오, 0 = 비혐오

    const info = commentMap.get(id);
    if (!info) return;

    if (label === 1) {
      // 혐오로 판단된 댓글은 통째로 숨김
      info.container.style.display = "none";
      info.container.dataset.__mlHidden = "1";
    }
  });
}


// ========================================
// 6) MutationObserver로 새 댓글 계속 감시
// ========================================

function startObserver() {
    //디버깅 용 로그
    console.log("[HateFilter] startObserver called");
  const observer = new MutationObserver(() => {
    // DOM에 변경이 생길 때마다 댓글 다시 스캔
    scanComments();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // 초기 한 번 실행
  scanComments();
}


// =======================
// 7) 페이지 로딩 후 시작
// =======================

// 유튜브는 SPA라서 약간 딜레이 주고 시작하는 게 안전
window.addEventListener("load", () => {
  setTimeout(() => {
    startObserver();
  }, 1500);
});