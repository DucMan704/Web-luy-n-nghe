const textInput = document.querySelector("#textInput");
const fileInput = document.querySelector("#fileInput");
const currentSentence = document.querySelector("#currentSentence");
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
let audioUrl;
let elevenLabsVoiceId;
let elevenLabsVoicePromise;
let speechRequestId = 0;
let isSpeechLoading = false;

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
    button.addEventListener("click", () => selectWord(item.index));
    wordBank.append(button);
  });
  selectedWords.forEach((wordIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-word";
    button.textContent = challengeWords[wordIndex].word;
    button.title = "Bấm để bỏ từ này khỏi đáp án";
    button.addEventListener("click", () => removeWord(wordIndex));
    answerZone.append(button);
  });
  if (!selectedWords.length && challengeWords.length) {
    answerZone.innerHTML =
      '<span class="answer-placeholder">Các từ bạn chọn sẽ xuất hiện ở đây</span>';
  }
  checkButton.disabled =
    !challengeWords.length || selectedWords.length !== challengeWords.length;
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
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sentences[currentIndex] }),
  });
  if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}`);
  const blob = await response.blob();
  if (requestId !== speechRequestId) return;
  audioUrl = URL.createObjectURL(blob);
  audioPlayer = new Audio(audioUrl);
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
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = undefined;
  }
  stopProgress();
  isSpeechLoading = false;
  playButton.disabled = false;
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
previousButton.addEventListener("click", () => {
  if (!sentences.length) return;
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
