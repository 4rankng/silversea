import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Play, RotateCcw } from 'lucide-react';
import { toursForRole } from '@tingting/shared';
import { Drawer } from '../UI';
import { useAuth } from '../../hooks/useAuth';
import { useTourController } from '../../context/TourControllerContext';
import { getInProgressStep, isTourCompleted } from '../../lib/tourProgress';
import { qk } from '../../api/keys';
import './tutorial-library.css';

interface TutorialLibraryProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS = {
  operations: 'Vận hành',
  finance: 'Tài chính',
  configuration: 'Cấu hình',
  administration: 'Quản trị',
} as const;

export function TutorialLibrary({ open, onClose }: TutorialLibraryProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { start, tour } = useTourController();
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) triggerRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  useEffect(() => {
    if (open) void queryClient.invalidateQueries({ queryKey: qk.auth.me });
  }, [open, queryClient]);

  const close = () => {
    onClose();
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  if (!user || !['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(user.role) || user.onboardingEnabled === false) return null;
  const tours = toursForRole(user.role);
  const groups = Object.entries(CATEGORY_LABELS).map(([category, label]) => ({
    category: category as keyof typeof CATEGORY_LABELS,
    label,
    tours: tours.filter((item) => item.category === category),
  })).filter((group) => group.tours.length > 0);

  return (
    <Drawer isOpen={open && !tour} onClose={close} title="Hướng dẫn sử dụng" subtitle="Chọn một luồng công việc để xem lại bất cứ lúc nào." className="tutorial-library">
      <div className="tutorial-library__body">
        {groups.map((group) => (
          <section key={group.category} className="tutorial-library__group" aria-label={group.label}>
            <h3>{group.label}</h3>
            {group.tours.map((item) => {
              const resumeStep = getInProgressStep(item.id, item.version);
              const completed = isTourCompleted(item.id, item.version);
              return (
                <article className="tutorial-library__item" key={item.id}>
                  <BookOpen size={18} aria-hidden="true" />
                  <div className="tutorial-library__copy">
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                    <small>{item.estimatedMinutes} phút · {completed ? 'Đã xem hướng dẫn' : resumeStep === null ? 'Chưa bắt đầu' : 'Đang xem'}{item.prerequisites?.length ? ` · ${item.prerequisites.join(' ')}` : ''}</small>
                  </div>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => { close(); start(item.id, resumeStep ?? undefined, 'manual'); }}>
                    {resumeStep === null ? <Play size={14} /> : <RotateCcw size={14} />} {resumeStep === null ? (completed ? 'Xem lại' : 'Bắt đầu') : 'Tiếp tục'}
                  </button>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </Drawer>
  );
}
