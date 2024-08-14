/*
 * SPDX-FileCopyrightText: Copyright (c) 2022 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

const id = Math.floor(Math.random() * 10000)
  .toString()
  .padStart(4, '0');
const resampleWorker = './resampler.js';
var localStream;
var sampleRate;
var rivaRunning = false;

var latencyTimer;
var websocket;
var socket;

// ---------------------------------------------------------------------------------------
// Latency tracking
// ---------------------------------------------------------------------------------------
class LatencyTimer {
  constructor() {
    this.startTimes = new Array();
    this.latencies = new Array();
  }

  start(data = null) {
    return this.startTimes.push({ start: performance.now(), data: data }) - 1;
  }

  end(index) {
    if (index >= this.startTimes.length) {
      return 0;
    }
    var latency = Math.round(performance.now() - this.startTimes[index].start);
    this.latencies.push(latency);
    return { latency: latency, data: this.startTimes[index].data };
  }

  average() {
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencies.length || 0);
  }
}

// ---------------------------------------------------------------------------------------
// Start Riva, whether triggered locally or by a message from peer
// ---------------------------------------------------------------------------------------
function startRivaService() {
  if (rivaRunning) {
    return;
  }
  console.log(io);
  socket = io('https://speech.adalat.ai', {
    auth: {
      token:
        'eyJhbGciOiJIUzI1NiIsImtpZCI6IlBXWEEzK2tQWXFzRitSWSsiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3VmcXl4dWlrd3FqZGZ2bnpqYmFxLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIyNTg1ZjVmYS03YTlkLTQ4N2ItYWY1Ny0wMDAwNjg0YjVjZGEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzIzNjM1MTg0LCJpYXQiOjE3MjM2MzE1ODQsImVtYWlsIjoicHJha2hhcmdvZWwuZ2dAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6e30sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3MjM2MzE1ODR9XSwic2Vzc2lvbl9pZCI6ImU5NTY5NGI0LWQ1ZDEtNDU4OC1hNGEzLTA1OWYyNTQyMmJjYyIsImlzX2Fub255bW91cyI6ZmFsc2V9.hvOa8JP0nfSxbIvzWeCz_hYpfpDHmymLuN2cU8kEd0U',
    },
  });

  document.getElementById('riva-btn').disabled = true;
  document.getElementById('riva-btn-stop').removeAttribute('disabled');
  latencyTimer = new LatencyTimer();

  if (true) {
    let audioInput = audio_context.createMediaStreamSource(localStream);
    let bufferSize = 4096;
    let recorder = audio_context.createScriptProcessor(bufferSize, 1, 1);

    socket.on('connect', async () => {
      debugger;
      socket?.emit('recognizer/register');
      socket?.emit('recognizer/start', { language: 'en-US', sampleRate: 16000 });

      // Start ASR streaming

      let worker = new Worker(resampleWorker);
      worker.postMessage({
        command: 'init',
        config: {
          sampleRate: sampleRate,
          outputSampleRate: 16000,
        },
      });

      // Use a worker thread to resample the audio, then send to server
      recorder.onaudioprocess = function (audioProcessingEvent) {
        let inputBuffer = audioProcessingEvent.inputBuffer;
        worker.postMessage({
          command: 'convert',
          // We only need the first channel
          buffer: inputBuffer.getChannelData(0),
        });
        worker.onmessage = function (msg) {
          if (msg.data.command == 'newBuffer') {
            socket.emit('recognizer/stream', msg.data.resampled.buffer);
          }
        };
      };

      // connect stream to our recorder
      audioInput.connect(recorder);
      // connect our recorder to the previous destination
      recorder.connect(audio_context.destination);
      rivaRunning = true;

      console.log('Streaming audio to server');
      toastr.success('Riva is connected.');
      socket.on('recognizer/recognized', (result) => {
        // Append text to the same paragraph
        var transcriptionArea = $('#transcription_area');
        if (transcriptionArea.find('p').length === 0) {
          transcriptionArea.append('<p></p>'); // Create a paragraph if it doesn't exist
        }
        transcriptionArea.find('p').append(result.alternatives[0]?.transcript + ' ');

        $('#transcription_card').animate({ scrollTop: 100000 }, 500);
        if (result.latencyIndex !== undefined) {
          var latencyResult = latencyTimer.end(result.latencyIndex);
          console.log('Latency: ' + latencyResult.latency.toString() + ' ms');
          console.log('Average latency (overall): ' + latencyTimer.average().toString() + ' ms');
        }
      });
      socket.on('recognizer/recognizing', (result) => {
        console.table({
          stability: result.stability,
          transcript: result.alternatives[0]?.transcript,
          confidence: result.alternatives[0]?.confidence,
        });
        document.getElementById('input_field').value = result.alternatives[0]?.transcript;
      });
    });

    socket.on('disconnect', async () => {
      console.log("Web socket closed: '" + JSON.stringify(result) + "'");
      audioInput.disconnect();
      recorder.disconnect();
      rivaRunning = false;
    });

    socket?.on('error', function (err) {
      bootbox.alert(err).find('.bootbox-close-button').addClass('float-end');
      console.error(err);
    });

    // Transcription results streaming back from Riva
  }
}

function stopRivaService() {
  console.log('Stop ASR websocket connection');
  document.getElementById('riva-btn-stop').disabled = true;
  document.getElementById('riva-btn').removeAttribute('disabled');
  socket.disconnect();
}

/**
 * Starts the request of the microphone
 *
 * @param {Object} callbacks
 */
function requestLocalAudio(callbacks) {
  // Monkeypatch for crossbrowser getUserMedia
  navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

  // Request audio and video
  // Try getting video, if it fails then go for audio only
  navigator.getUserMedia({ audio: true, video: false }, callbacks.success, function () {
    // error -- can't access video. Try audio only
    navigator.getUserMedia({ audio: true }, callbacks.success, callbacks.error);
  });
}

$(document).ready(function () {
  /**
   * Request browser audio and video, and show the local stream
   */
  requestLocalAudio({
    success: function (stream) {
      localStream = stream;
      audio_context = new AudioContext();
      sampleRate = audio_context.sampleRate;
      console.log('Sample rate of local audio: ' + sampleRate);
    },
    error: function (err) {
      bootbox.alert('Cannot get access to your microphone.').find('.bootbox-close-button').addClass('float-end');
      console.error(err);
    },
  });
});

// ---------------------------------------------------------------------------------------
// On clicking the Start button, start Riva
// ---------------------------------------------------------------------------------------
$(document).on('click', '#riva-btn', function (e) {
  startRivaService();
});

$(document).on('click', '#riva-btn-stop', function (e) {
  stopRivaService();
});
