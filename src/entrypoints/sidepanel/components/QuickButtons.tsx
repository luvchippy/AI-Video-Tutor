import type { QuestionIntent } from '@/types/intent';
import { useApp } from '../AppContext';

interface QuickAction {
  label: string;
  intent: QuestionIntent;
  question: string;
  needsVideo: boolean;
  needsVision: boolean;
  reason?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: '解释这里',
    intent: 'VIDEO_CONTENT',
    question: '解释一下当前这里的内容',
    needsVideo: true,
    needsVision: false,
    reason: '没有检测到视频',
  },
  {
    label: '刚才没懂',
    intent: 'BEGINNER_EXPLANATION',
    question: '刚才这一段我没听懂，请用更基础的方式解释一下',
    needsVideo: true,
    needsVision: false,
    reason: '没有检测到视频',
  },
  {
    label: '分析画面',
    intent: 'VISUAL_QUESTION',
    question: '分析一下当前画面里的内容',
    needsVideo: true,
    needsVision: true,
    reason: '当前模型不支持图片输入',
  },
  {
    label: '核实他说的',
    intent: 'FACT_CHECK',
    question: '博主刚才说的是真的吗？请帮我核实',
    needsVideo: true,
    needsVision: false,
    reason: '没有检测到视频',
  },
];

export function QuickButtons({ onPick }: { onPick: (q: string, intent: QuestionIntent) => void }) {
  const { runtime, localVideo } = useApp();
  const caps = runtime?.capabilityStatus;
  const hasVideo = localVideo != null || runtime?.hasVideo === true;

  return (
    <div className="quick-buttons">
      {QUICK_ACTIONS.map((a) => {
        const disabled = a.needsVideo ? !hasVideo : a.needsVision ? !caps?.vision : false;
        return (
          <button
            key={a.label}
            className="quick-btn"
            disabled={disabled}
            title={disabled ? a.reason : undefined}
            onClick={() => onPick(a.question, a.intent)}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
