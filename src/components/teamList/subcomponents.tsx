import { motion } from 'motion/react';
import type { User, UserRole, Task } from '../../types';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { ROLE_LABELS } from '../../constants';

// Rol rozeti her zaman "dolu" (belirgin arka plan + kenarlık) kalmalı ki
// Kadro kartlarındaki nötr/ghost departman rozetiyle karışmasın — Manager'ın
// eski %4 opaklığı, %5 opaklıktaki surface-glass departman zeminiyle neredeyse
// ayırt edilemiyordu (bkz. kod denetimi).
export const roleConfig: Record<UserRole, { bg: string; text: string; border: string }> = {
  Admin:   { bg: 'bg-status-danger/10',  text: 'text-status-danger',  border: 'border-status-danger/25' },
  Manager: { bg: 'bg-executive-blue/10', text: 'text-executive-blue', border: 'border-executive-blue/25' },
  Staff:   { bg: 'bg-text-muted/10',     text: 'text-text-muted',     border: 'border-text-muted/25' },
};

export interface OrgNodeCardProps {
  user: User;
  tasks: Task[];
  onSelect: (user: User) => void;
  isMini?: boolean;
}

export const OrgNodeCard = ({ user, tasks, onSelect, isMini = false }: OrgNodeCardProps) => {
  const rc = roleConfig[user.role];
  const userTasks = tasks.filter(t => (t.assigneeId === user.uid || t.assigneeId === user.email) && t.status !== 'COMPLETED' && t.status !== 'CANCELLED');

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      onClick={() => onSelect(user)}
      className={cn(
        "flex items-center gap-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl p-2.5 shadow-sm hover:shadow-md cursor-pointer hover:bg-surface-elevated transition-all",
        isMini ? "w-44" : "w-52"
      )}
    >
      <Avatar name={user.fullName} photoURL={user.photoURL} size={isMini ? "sm" : "md"} ring className="flex-shrink-0" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1 text-left">
        <span className="text-[11px] font-medium text-executive-blue truncate font-serif leading-none">{user.fullName}</span>
        <span className="text-[8px] text-text-tertiary truncate leading-none mt-0.5">{user.departmentId || 'Genel Merkez'}</span>
        {!isMini && (
          <span className={cn("inline-block self-start text-[6.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border mt-1", rc.bg, rc.text, rc.border)}>
            {ROLE_LABELS[user.role]}
          </span>
        )}
      </div>
      {userTasks.length > 0 && (
        <span className={cn(
          "w-5 h-5 flex items-center justify-center rounded-full text-[8.5px] font-bold flex-shrink-0 border transition-all duration-300",
          userTasks.length >= 5 ? "bg-status-danger/10 border-status-danger/25 text-status-danger animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.2)]" :
          userTasks.length >= 3 ? "bg-status-warning/10 border-status-warning/25 text-status-warning" :
          "bg-status-success/10 border-status-success/25 text-status-success"
        )}>
          {userTasks.length}
        </span>
      )}
    </motion.div>
  );
};
