import { useState, useCallback } from 'react';
import * as Tone from 'tone';

export type AudioEffect = 'none' | 'reverb' | 'distortion' | 'delay' | 'pitch-up' | 'pitch-down';

export function useAudioEffects() {
  const [currentEffect, setCurrentEffect] = useState<AudioEffect>('none');
  
  const applyEffect = useCallback(async (audioBuffer: AudioBuffer): Promise<AudioBuffer> => {
    if (currentEffect === 'none') return audioBuffer;

    await Tone.start();
    const player = new Tone.Player().toDestination();
    let effect: Tone.ToneAudioNode;

    switch (currentEffect) {
      case 'reverb':
        effect = new Tone.Reverb({
          decay: 2,
          wet: 0.5
        }).toDestination();
        break;
      case 'distortion':
        effect = new Tone.Distortion({
          distortion: 0.5,
          wet: 0.5
        }).toDestination();
        break;
      case 'delay':
        effect = new Tone.FeedbackDelay({
          delayTime: 0.25,
          feedback: 0.5,
          wet: 0.5
        }).toDestination();
        break;
      case 'pitch-up':
        effect = new Tone.PitchShift({
          pitch: 12,
          wet: 1
        }).toDestination();
        break;
      case 'pitch-down':
        effect = new Tone.PitchShift({
          pitch: -12,
          wet: 1
        }).toDestination();
        break;
      default:
        return audioBuffer;
    }

    player.chain(effect);
    player.buffer = new Tone.ToneAudioBuffer(audioBuffer);
    
    return new Promise((resolve) => {
      const duration = audioBuffer.duration;
      const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.sampleRate * duration,
        audioBuffer.sampleRate
      );
      
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineContext.destination);
      source.start();
      
      offlineContext.startRendering().then((renderedBuffer) => {
        resolve(renderedBuffer);
      });
    });
  }, [currentEffect]);

  return {
    currentEffect,
    setCurrentEffect,
    applyEffect
  };
}
