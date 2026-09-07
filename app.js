const textInput = document.querySelector("#textInput");
const fileInput = document.querySelector("#fileInput");
const currentSentence = document.querySelector("#currentSentence");
const textToggleButton = document.querySelector("#textToggleButton");
const sentenceIndex = document.querySelector("#sentenceIndex");
const lineCount = document.querySelector("#lineCount");
const playButton = document.querySelector("#playButton");
const playIcon = document.querySelector("#playIcon");
const previousButton = document.querySelector("#previousButton");
const nextButton = document.querySelector("#nextButton");
const progressBar = document.querySelector("#progressBar");
const volumeBar = document.querySelector("#volumeBar");
const volumeValue = document.querySelector("#volumeValue");
const elapsedTime = document.querySelector("#elapsedTime");
const totalTime = document.querySelector("#totalTime");
const statusText = document.querySelector("#statusText");
const voiceStatus = document.querySelector("#voiceStatus");
const wordBank = document.querySelector("#wordBank");
const answerZone = document.querySelector("#answerZone");
const challengeCount = document.querySelector("#challengeCount");
const challengeHint = document.querySelector("#challengeHint");
const challengeFeedback = document.querySelector("#challengeFeedback");
const checkButton = document.querySelector("#checkButton");
const challengePanel = document.querySelector("#challengePanel");
const loadSourceButton = document.querySelector("#loadSourceButton");

let sentences = [];
let currentIndex = -1;
let isPlaying = false;
let speed = 1;
let volume = 1;
let timer;
let startedAt = 0;
let duration = 0;
let challengeWords = [];
let wordBankOrder = [];
let selectedWords = [];
let audioContext;
let audioPlayer;
let cachedAudioUrl;
let elevenLabsVoiceId;
let elevenLabsVoicePromise;
let speechRequestId = 0;
let isSpeechLoading = false;
let isSentenceHidden = false;
const translationCache = new Map();
let activeTranslationTooltip;
let draggedWordIndex;
let draggedWordSource;

function playFeedbackSound(type) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  const notes =
    type === "correct"
      ? [523.25, 659.25, 783.99]
      : type === "wrong"
        ? [180, 140]
        : [330];
  const start = audioContext.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type === "wrong" ? "sawtooth" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + index * 0.08);
    gain.gain.exponentialRampToValueAtTime(
      type === "click" ? 0.045 : 0.07,
      start + index * 0.08 + 0.015,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + index * 0.08 + (type === "correct" ? 0.18 : 0.12),
    );
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start + index * 0.08);
    oscillator.stop(start + index * 0.08 + 0.2);
  });
}

function animateChallenge(result) {
  challengePanel.classList.remove("is-correct", "is-wrong");
  checkButton.classList.remove("is-correct", "is-wrong");
  void challengePanel.offsetWidth;
  challengePanel.classList.add(`is-${result}`);
  checkButton.classList.add(`is-${result}`);
}

function getSentences() {
  return textInput.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function estimateDuration(sentence) {
  return Math.max(2200, (sentence.split(/\s+/).length / (2.25 * speed)) * 1000);
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `00:${String(Math.min(seconds, 59)).padStart(2, "0")}`;
}

function updateList() {
  sentences = getSentences();
  lineCount.textContent = `${sentences.length} câu`;
  if (!sentences.length) {
    currentIndex = -1;
    currentSentence.textContent = "Thêm vài câu để bắt đầu.";
    sentenceIndex.textContent = "— / —";
    stopPlayback();
  } else if (currentIndex === -1) {
    chooseRandomSentence(false);
  } else if (currentIndex >= sentences.length) {
    currentIndex = 0;
    renderSentence();
  }
}

function updateDraftCount() {
  const draftCount = getSentences().length;
  lineCount.textContent = draftCount ? `${draftCount} câu chờ nộp` : "0 câu";
}

function submitSource() {
  stopPlayback();
  clearAudioCache();
  currentIndex = -1;
  updateList();
  statusText.textContent = sentences.length
    ? "Đã nạp nguồn câu mới"
    : "Chưa có câu để luyện nghe";
}

function chooseRandomSentence(autoplay = true) {
  if (!sentences.length) return;
  if (autoplay) {
    speechRequestId += 1;
    stopAudio();
    window.speechSynthesis.cancel();
  }
  clearAudioCache();
  let nextIndex = Math.floor(Math.random() * sentences.length);
  if (sentences.length > 1 && nextIndex === currentIndex)
    nextIndex = (nextIndex + 1) % sentences.length;
  currentIndex = nextIndex;
  renderSentence();
  if (autoplay) speak();
}

function renderSentence() {
  currentSentence.textContent =
    sentences[currentIndex] || "Thêm vài câu để bắt đầu.";
  sentenceIndex.textContent =
    currentIndex < 0
      ? "— / —"
      : `${String(currentIndex + 1).padStart(2, "0")} / ${String(sentences.length).padStart(2, "0")}`;
  duration = estimateDuration(sentences[currentIndex] || "");
  totalTime.textContent = formatTime(duration);
  progressBar.value = 0;
  elapsedTime.textContent = "00:00";
  currentSentence.classList.toggle("is-hidden", isSentenceHidden);
  setupChallenge();
}

function setupChallenge() {
  selectedWords = [];
  challengeWords = sentences[currentIndex]
    ? sentences[currentIndex]
        .trim()
        .split(/\s+/)
        .map((word, index) => ({ word, index }))
    : [];
  wordBankOrder = [...challengeWords];
  shuffle(wordBankOrder);
  challengeCount.textContent = `${challengeWords.length} từ`;
  challengeHint.textContent = challengeWords.length
    ? "Chọn từng từ để đặt chúng vào đúng thứ tự."
    : "Thêm câu ở phía trên để bắt đầu bài tập.";
  challengeFeedback.textContent = "";
  challengeFeedback.className = "challenge-feedback";
  preloadTranslations();
  renderChallenge();
}

function renderChallenge() {
  wordBank.replaceChildren();
  answerZone.replaceChildren();
  if (!challengeWords.length) {
    answerZone.innerHTML =
      '<span class="answer-placeholder">Các từ bạn chọn sẽ xuất hiện ở đây</span>';
  }
  wordBankOrder.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `word-button${selectedWords.includes(item.index) ? " used" : ""}`;
    button.textContent = item.word;
    button.disabled = selectedWords.includes(item.index);
    button.draggable = !button.disabled;
    button.addEventListener("click", () => selectWord(item.index));
    button.addEventListener("dragstart", (event) => {
      draggedWordIndex = item.index;
      draggedWordSource = "bank";
      event.dataTransfer.effectAllowed = "move";
      button.classList.add("is-dragging");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      clearAnswerDropGaps();
    });
    addTranslationTooltip(button, item.word);
    wordBank.append(button);
  });
  selectedWords.forEach((wordIndex, position) => {
    answerZone.append(createAnswerDropGap(position));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-word";
    button.textContent = challengeWords[wordIndex].word;
    button.title = "Bấm để bỏ từ này khỏi đáp án";
    button.draggable = true;
    button.addEventListener("click", () => removeWord(wordIndex));
    button.addEventListener("dragstart", (event) => {
      draggedWordIndex = wordIndex;
      draggedWordSource = "answer";
      event.dataTransfer.effectAllowed = "move";
      button.classList.add("is-dragging");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      clearAnswerDropGaps();
    });
    button.addEventListener("dragover", (event) => event.preventDefault());
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveWordToPosition(selectedWords.indexOf(wordIndex));
    });
    addTranslationTooltip(button, challengeWords[wordIndex].word);
    answerZone.append(button);
  });
  if (selectedWords.length) {
    answerZone.append(createAnswerDropGap(selectedWords.length));
  }
  if (!selectedWords.length && challengeWords.length) {
    answerZone.innerHTML =
      '<span class="answer-placeholder">Các từ bạn chọn sẽ xuất hiện ở đây</span>';
  }
  checkButton.disabled =
    !challengeWords.length || selectedWords.length !== challengeWords.length;
}

function clearAnswerDropGaps() {
  answerZone
    .querySelectorAll(".answer-drop-gap")
    .forEach((dropGap) => dropGap.classList.remove("is-active"));
}

function createAnswerDropGap(position) {
  const dropGap = document.createElement("span");
  dropGap.className = "answer-drop-gap";
  dropGap.setAttribute("aria-hidden", "true");
  dropGap.addEventListener("dragover", (event) => {
    event.preventDefault();
    clearAnswerDropGaps();
    dropGap.classList.add("is-active");
  });
  dropGap.addEventListener("drop", (event) => {
    event.preventDefault();
    moveWordToPosition(position);
  });
  return dropGap;
}

async function loadTranslation(word) {
  const normalizedWord = word.replace(/[.,!?;:()[\]{}"']/g, "").trim();
  if (!normalizedWord || translationCache.has(normalizedWord)) return;
  const response = await fetch(
    `/api/translate?q=${encodeURIComponent(normalizedWord)}`,
  );
  if (!response.ok) throw new Error("Translation request failed");
  const { translatedText } = await response.json();
  if (!translatedText) throw new Error("Empty translation");
  translationCache.set(normalizedWord, translatedText);
}

async function preloadTranslations() {
  const words = [...new Set(challengeWords.map((item) => item.word))];
  for (const word of words) {
    try {
      await loadTranslation(word);
    } catch {}
  }
}

function addTranslationTooltip(button, word) {
  const normalizedWord = word.replace(/[.,!?;:()[\]{}"']/g, "").trim();
  if (!normalizedWord) return;
  button.addEventListener("mouseenter", () =>
    showTranslation(button, normalizedWord),
  );
  button.addEventListener("focus", () =>
    showTranslation(button, normalizedWord),
  );
  button.addEventListener("mouseleave", hideTranslation);
  button.addEventListener("blur", hideTranslation);
}

async function showTranslation(button, word) {
  hideTranslation();
  const tooltip = document.createElement("span");
  tooltip.className = "translation-tooltip";
  tooltip.textContent = "Đang dịch…";
  button.append(tooltip);
  activeTranslationTooltip = tooltip;

  try {
    await loadTranslation(word);
    const translatedText = translationCache.get(word);
    if (activeTranslationTooltip === tooltip)
      tooltip.textContent = translatedText;
  } catch {
    if (activeTranslationTooltip === tooltip)
      tooltip.textContent = "Chưa lấy được nghĩa";
  }
}

function hideTranslation() {
  activeTranslationTooltip?.remove();
  activeTranslationTooltip = undefined;
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
}

function selectWord(wordIndex) {
  if (!selectedWords.includes(wordIndex)) {
    selectedWords.push(wordIndex);
    playFeedbackSound("click");
    challengeFeedback.textContent = "";
    challengeFeedback.className = "challenge-feedback";
    renderChallenge();
  }
}

function removeWord(wordIndex) {
  selectedWords = selectedWords.filter((index) => index !== wordIndex);
  playFeedbackSound("click");
  renderChallenge();
}

function moveWordToPosition(insertionPosition) {
  if (draggedWordIndex === undefined) return;
  if (draggedWordSource === "bank") {
    if (selectedWords.includes(draggedWordIndex)) return;
    selectedWords.splice(insertionPosition, 0, draggedWordIndex);
  } else {
    const sourcePosition = selectedWords.indexOf(draggedWordIndex);
    if (sourcePosition < 0) return;
    selectedWords.splice(sourcePosition, 1);
    if (sourcePosition < insertionPosition) insertionPosition -= 1;
    selectedWords.splice(insertionPosition, 0, draggedWordIndex);
  }
  draggedWordIndex = undefined;
  draggedWordSource = undefined;
  challengeFeedback.textContent = "";
  challengeFeedback.className = "challenge-feedback";
  playFeedbackSound("click");
  renderChallenge();
}

function checkChallenge() {
  if (selectedWords.length !== challengeWords.length) return;
  const answer = selectedWords
    .map((index) => challengeWords[index].word)
    .join(" ");
  const solution = challengeWords.map((item) => item.word).join(" ");
  if (answer === solution) {
    playFeedbackSound("correct");
    animateChallenge("correct");
    challengeFeedback.textContent = "Chính xác! Đang chuyển sang câu mới…";
    challengeFeedback.className = "challenge-feedback success";
    checkButton.disabled = true;
    window.setTimeout(() => chooseRandomSentence(true), 650);
  } else {
    playFeedbackSound("wrong");
    animateChallenge("wrong");
    challengeFeedback.textContent =
      "Chưa đúng. Bấm vào từ đã chọn để sắp xếp lại rồi thử tiếp.";
    challengeFeedback.className = "challenge-feedback error";
  }
}

function speak() {
  if (!sentences.length || isSpeechLoading) return;
  speechRequestId += 1;
  const requestId = speechRequestId;
  stopAudio();
  isSpeechLoading = true;
  playButton.disabled = true;
  window.speechSynthesis.cancel();
  speakWithElevenLabs(requestId)
    .catch(() => {
      if (requestId !== speechRequestId) return;
      voiceStatus.textContent =
        "ElevenLabs không khả dụng · dùng giọng trình duyệt";
      speakWithBrowser();
    })
    .finally(() => {
      if (!audioPlayer && requestId === speechRequestId) {
        isSpeechLoading = false;
        playButton.disabled = false;
      }
    });
}

async function speakWithElevenLabs(requestId) {
  statusText.textContent = "Đang tải giọng đọc DELF B2…";
  const sentence = sentences[currentIndex];
  if (!cachedAudioUrl) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence }),
    });
    if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}`);
    const blob = await response.blob();
    if (requestId !== speechRequestId) return;
    cachedAudioUrl = URL.createObjectURL(blob);
  }
  if (requestId !== speechRequestId) return;
  audioPlayer = new Audio(cachedAudioUrl);
  audioPlayer.volume = volume;
  audioPlayer.playbackRate = speed;
  audioPlayer.onloadedmetadata = () => {
    duration = audioPlayer.duration * 1000;
    totalTime.textContent = formatTime(duration);
  };
  audioPlayer.onplay = () => {
    isSpeechLoading = false;
    playButton.disabled = false;
    isPlaying = true;
    updatePlayer();
    statusText.textContent = "Đang đọc bằng ElevenLabs · DELF B2";
    startAudioProgress();
  };
  audioPlayer.onended = () => {
    isSpeechLoading = false;
    playButton.disabled = false;
    isPlaying = false;
    stopProgress();
    progressBar.value = 100;
    elapsedTime.textContent = formatTime(duration);
    updatePlayer();
    statusText.textContent = "Câu vừa phát xong";
  };
  audioPlayer.onerror = () => {
    isSpeechLoading = false;
    playButton.disabled = false;
    clearAudioCache();
    stopAudio();
    speakWithBrowser();
  };
  await audioPlayer.play();
}

function speakWithBrowser() {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(sentences[currentIndex]);
  utterance.lang = "fr-FR";
  utterance.rate = speed;
  utterance.volume = volume;
  const frenchVoice = selectFrenchVoice();
  if (frenchVoice) utterance.voice = frenchVoice;
  utterance.onstart = () => {
    isSpeechLoading = false;
    playButton.disabled = false;
    isPlaying = true;
    updatePlayer();
    startedAt = Date.now();
    startProgress();
  };
  utterance.onend = () => {
    isPlaying = false;
    stopProgress();
    progressBar.value = 100;
    elapsedTime.textContent = formatTime(duration);
    updatePlayer();
    statusText.textContent = "Câu vừa phát xong";
  };
  utterance.onerror = () => {
    isSpeechLoading = false;
    playButton.disabled = false;
    isPlaying = false;
    stopProgress();
    updatePlayer();
    statusText.textContent = "Không thể phát câu này";
  };
  window.speechSynthesis.speak(utterance);
  statusText.textContent = "Đang dùng giọng đọc dự phòng của trình duyệt";
}

function startAudioProgress() {
  stopProgress();
  timer = setInterval(() => {
    if (!audioPlayer || !audioPlayer.duration) return;
    progressBar.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    elapsedTime.textContent = formatTime(audioPlayer.currentTime * 1000);
  }, 80);
}

function stopAudio() {
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer = null;
  }
  stopProgress();
  isSpeechLoading = false;
  playButton.disabled = false;
}

function clearAudioCache() {
  if (cachedAudioUrl) {
    URL.revokeObjectURL(cachedAudioUrl);
    cachedAudioUrl = undefined;
  }
}

function selectFrenchVoice() {
  const voices = speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("fr"));
  const preferredNames = [
    "denise",
    "hortense",
    "thomas",
    "amelie",
    "audrey",
    "google français",
    "google francais",
  ];
  return voices.sort((first, second) => {
    const firstScore = preferredNames.findIndex((name) =>
      first.name.toLowerCase().includes(name),
    );
    const secondScore = preferredNames.findIndex((name) =>
      second.name.toLowerCase().includes(name),
    );
    return (
      (secondScore < 0 ? preferredNames.length : secondScore) -
      (firstScore < 0 ? preferredNames.length : firstScore)
    );
  })[0];
}

function startProgress() {
  stopProgress();
  timer = setInterval(() => {
    const progress = Math.min(Date.now() - startedAt, duration);
    progressBar.value = (progress / duration) * 100;
    elapsedTime.textContent = formatTime(progress);
  }, 80);
}

function stopProgress() {
  clearInterval(timer);
}
function stopPlayback() {
  stopAudio();
  window.speechSynthesis?.cancel();
  isPlaying = false;
  stopProgress();
  updatePlayer();
}
function updatePlayer() {
  playIcon.textContent = isPlaying ? "Ⅱ" : "▶";
}

textInput.addEventListener("input", updateDraftCount);
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    textInput.value = reader.result;
    updateDraftCount();
  };
  reader.readAsText(file);
});
loadSourceButton.addEventListener("click", submitSource);
document.querySelector("#clearButton").addEventListener("click", () => {
  textInput.value = "";
  clearAudioCache();
  currentIndex = -1;
  updateList();
  textInput.focus();
});
playButton.addEventListener("click", () => {
  if (isPlaying) stopPlayback();
  else if (currentIndex < 0) chooseRandomSentence(true);
  else speak();
});
nextButton.addEventListener("click", () => chooseRandomSentence(true));
checkButton.addEventListener("click", checkChallenge);
answerZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  answerZone.classList.add("drag-over");
});
answerZone.addEventListener("dragleave", () => {
  answerZone.classList.remove("drag-over");
});
answerZone.addEventListener("drop", (event) => {
  event.preventDefault();
  answerZone.classList.remove("drag-over");
  if (draggedWordSource === "bank" && draggedWordIndex !== undefined) {
    selectedWords.push(draggedWordIndex);
    draggedWordIndex = undefined;
    draggedWordSource = undefined;
    playFeedbackSound("click");
    renderChallenge();
  }
});
textToggleButton.addEventListener("click", () => {
  isSentenceHidden = !isSentenceHidden;
  currentSentence.classList.toggle("is-hidden", isSentenceHidden);
  textToggleButton.setAttribute("aria-pressed", String(isSentenceHidden));
  textToggleButton.firstChild.textContent = isSentenceHidden
    ? "Hiện chữ "
    : "Ẩn chữ ";
});
previousButton.addEventListener("click", () => {
  if (!sentences.length) return;
  clearAudioCache();
  currentIndex = (currentIndex - 1 + sentences.length) % sentences.length;
  renderSentence();
  speak();
});
progressBar.addEventListener("input", () => {
  if (!sentences.length) return;
  if (audioPlayer?.duration) {
    audioPlayer.currentTime =
      (Number(progressBar.value) / 100) * audioPlayer.duration;
    return;
  }
  const targetIndex = Math.min(
    sentences.length - 1,
    Math.floor((Number(progressBar.value) / 100) * sentences.length),
  );
  if (targetIndex !== currentIndex) {
    clearAudioCache();
    currentIndex = targetIndex;
    renderSentence();
  }
  speak();
});
volumeBar.addEventListener("input", () => {
  volume = Number(volumeBar.value);
  volumeValue.textContent = `${Math.round(volume * 100)}%`;
  if (audioPlayer) audioPlayer.volume = volume;
});
document.querySelector("#speedButtons").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  speed = Number(button.dataset.speed);
  document
    .querySelectorAll("#speedButtons button")
    .forEach((item) => item.classList.toggle("active", item === button));
  if (isPlaying) speak();
  else renderSentence();
});
window.speechSynthesis?.addEventListener("voiceschanged", () => {
  const french = selectFrenchVoice();
  voiceStatus.textContent = french
    ? `Đã sẵn sàng: ${french.name} · DELF B2`
    : "Trình duyệt sẽ dùng giọng Pháp mặc định";
});
updateList();
