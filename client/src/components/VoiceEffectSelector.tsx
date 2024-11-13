import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AudioEffect } from '../hooks/use-audio-effects';

interface VoiceEffectSelectorProps {
  currentEffect: AudioEffect;
  onEffectChange: (effect: AudioEffect) => void;
}

export function VoiceEffectSelector({ currentEffect, onEffectChange }: VoiceEffectSelectorProps) {
  return (
    <div className="space-y-2">
      <Select value={currentEffect} onValueChange={(value) => onEffectChange(value as AudioEffect)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select an effect" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Voice Effects</SelectLabel>
            <SelectItem value="none">No Effect</SelectItem>
            <SelectItem value="reverb">Reverb</SelectItem>
            <SelectItem value="distortion">Distortion</SelectItem>
            <SelectItem value="delay">Delay</SelectItem>
            <SelectItem value="pitch-up">Pitch Up</SelectItem>
            <SelectItem value="pitch-down">Pitch Down</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
