import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Task, User, TaskPrioritySchema } from '../types';
import { PRIORITY_LABELS, ROLE_LABELS } from '../constants';
import { cn } from '../lib/utils';
import { FileText, Target, Users, Calendar, AlertCircle } from 'lucide-react';
import { DatePicker } from './ui/DatePicker';

const taskSchema = z.object({
  title: z.string().min(1, 'Başlık zorunludur.').trim(),
  description: z.string().min(1, 'Açıklama zorunludur.').trim(),
  assigneeId: z.string().min(1, 'Sorumlu seçimi zorunludur.'),
  coordinatorId: z.string().optional(),
  priority: TaskPrioritySchema,
  deadline: z.string().min(1, 'Mühlet seçilmelidir.')
}).refine(data => {
  if (data.coordinatorId && data.coordinatorId === data.assigneeId) {
    return false;
  }
  return true;
}, {
  message: "İrtibatlı kişi, sorumlu kişi ile aynı olamaz.",
  path: ["coordinatorId"]
});

type TaskFormValues = z.infer<typeof taskSchema>;

interface TaskFormModalProps {
  users: User[];
  currentUser: User | null;
  task?: Task;
  parentId?: string;
  initialTitle?: string;
  onSubmit: (taskData: Partial<Task>) => void;
  onClose: () => void;
}

export const TaskFormModal = ({ users, currentUser, task, parentId, initialTitle, onSubmit, onClose }: TaskFormModalProps) => {
  const isSubTask = Boolean(parentId);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title || initialTitle || '',
      description: task?.description || '',
      assigneeId: task?.assigneeId || '',
      coordinatorId: task?.coordinatorId || '',
      priority: task?.priority || 'Medium',
      deadline: task?.deadline ? new Date(task.deadline).toISOString().split('T')[0] : '',
    }
  });

  const assigneeId = watch('assigneeId');
  const deadline = watch('deadline');

  const getAssignableRoles = (role?: string) => {
    if (role === 'Admin') return ['Admin', 'Manager', 'Staff'];
    if (role === 'Manager') return ['Manager', 'Staff'];
    return ['Staff'];
  };

  const allowedRoles = isSubTask
    ? ['Staff']
    : getAssignableRoles(currentUser?.role);

  const assignableUsers = users.filter(u => allowedRoles.includes(u.role));

  const coordinatorUsers = users.filter(
    u => u.role !== 'Admin'
      && u.uid !== assigneeId
      && (!isSubTask || u.role === 'Staff')
  );

  const processForm = async (data: TaskFormValues) => {
    try {
      // updatedAt burada elle gönderilmiyor — taskService.createTask/updateTask
      // bunu zaten kendisi (senkron anına göre) set ediyor. Burada gönderilmesi
      // yalnızca denetim izi diff'inde anlamsız bir "UpdatedAt" satırı olarak
      // görünmesine yol açıyordu (bkz. kod denetimi).
      const taskData: Partial<Task> = {
        title: data.title,
        description: data.description,
        assigneeId: data.assigneeId,
        coordinatorId: data.coordinatorId || undefined,
        priority: data.priority,
        deadline: new Date(data.deadline).getTime(),
      };

      if (!task) {
        taskData.status = 'ASSIGNED';
        taskData.creatorId = currentUser?.uid;
        taskData.createdAt = Date.now();
        if (currentUser?.departmentId) {
          taskData.departmentId = currentUser.departmentId;
        }
        if (parentId) {
          taskData.parentId = parentId;
        }
      }

      onSubmit(taskData);
    } catch (err) {
      console.error('TaskFormModal submit error:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit(processForm)} className="flex flex-col gap-8 font-sans">
      <div className="flex flex-col gap-8">
        {/* Başlık */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
            <Target className="w-3.5 h-3.5 text-executive-gold stroke-[1.2]" />
            Operasyonel Hedef
          </label>
          <input
            type="text"
            placeholder="Talimat Başlığı"
            {...register('title')}
            className={cn(
              "text-[28px] font-light text-text-heading font-serif tracking-tight outline-none bg-transparent placeholder:text-text-muted/30 w-full border-b border-makam-border/10 pb-3 transition-colors focus:border-executive-blue/40",
              errors.title && "border-status-danger/50 focus:border-status-danger/50"
            )}
          />
          {errors.title && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.title.message}</span>}
        </div>
        
        {/* Açıklama */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
            <FileText className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
            Kapsam & Detaylar
          </label>
          <textarea
            className={cn(
              "w-full min-h-[140px] resize-none bg-surface-elevated border border-makam-border/10 text-text-heading placeholder:text-text-muted/30 rounded-xl px-5 py-4 text-[14px] font-light leading-relaxed transition-all outline-none focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
              errors.description && "border-status-danger/50"
            )}
            placeholder="İşin detaylarını ve başarı kriterlerini tanımlayın..."
            {...register('description')}
          />
          {errors.description && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.description.message}</span>}
        </div>

        {/* Görevlendirmeler */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex flex-col gap-3">
             <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
               <Users className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
               İcra Makamı
             </label>
             {isSubTask && (
               <p className="text-[9px] text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
                 <AlertCircle className="w-3 h-3 flex-shrink-0" />
                 Alt talimatlar yalnızca memurlara atanabilir.
               </p>
             )}
             <select 
              {...register('assigneeId')}
              className={cn(
                "w-full bg-surface-elevated border border-makam-border/10 rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.assigneeId && "border-status-danger/50"
              )}
            >
              <option value="">Sorumlu Seçiniz</option>
              {assignableUsers.map(m => (
                <option key={m.uid} value={m.uid}>{m.fullName}</option>
              ))}
            </select>
            {errors.assigneeId && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.assigneeId.message}</span>}
          </div>

          <div className="flex flex-col gap-3">
             <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
               <Users className="w-3.5 h-3.5 text-text-muted/40 stroke-[1.2]" />
               İrtibatlı
             </label>
             <select 
              {...register('coordinatorId')}
              className={cn(
                "w-full bg-surface-elevated border border-makam-border/10 rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.coordinatorId && "border-status-danger/50"
              )}
            >
              <option value="">İrtibatlı Seçiniz (İsteğe Bağlı)</option>
              {coordinatorUsers.map(m => (
                <option key={m.uid} value={m.uid}>{m.fullName} — {ROLE_LABELS[m.role]}</option>
              ))}
            </select>
             {errors.coordinatorId ? (
                <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.coordinatorId.message}</span>
             ) : (
                <p className="text-[9px] text-text-muted/40 px-1 tracking-wide">
                  Sorumludan farklı biri seçilmelidir.
                </p>
             )}
          </div>

          <div className="flex flex-col gap-3">
             <label className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
               <AlertCircle className="w-3.5 h-3.5 text-executive-gold stroke-[1.2]" />
               Öncelik
             </label>
             <select 
              {...register('priority')}
              className="w-full bg-surface-elevated border border-makam-border/10 rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5"
            >
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {errors.priority && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.priority.message}</span>}
          </div>
        </div>

        {/* Tarih */}
        <div className="flex flex-col gap-3">
          <label htmlFor="task-deadline" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
            <Calendar className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
            SLA Mühleti
          </label>
          <div
            className={cn(
              "w-full flex items-center gap-3 bg-surface-elevated border border-makam-border/10 rounded-xl px-4 py-3 transition-all focus-within:border-executive-blue/30 focus-within:ring-4 focus-within:ring-executive-blue/5",
              errors.deadline && "border-status-danger/50"
            )}
          >
            <Calendar className="w-3.5 h-3.5 text-executive-blue/60 stroke-[1.2] flex-shrink-0" aria-hidden="true" />
            <DatePicker
              id="task-deadline"
              value={deadline}
              onChange={(v) => setValue('deadline', v, { shouldValidate: true, shouldDirty: true })}
              ariaLabel="SLA mühleti"
              className="flex-1"
            />
          </div>
          {errors.deadline && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.deadline.message}</span>}
        </div>
      </div>

      {/* Aksiyonlar */}
      <div className="flex justify-end gap-5 pt-10 border-t border-makam-border/5">
        <button 
          type="button" 
          onClick={onClose} 
          className="makam-button-secondary px-10 h-14 font-normal"
        >
          İPTAL
        </button>
        <button 
          type="submit" 
          disabled={isSubmitting}
          className="makam-button-primary px-12 h-14 font-semibold tracking-[0.16em]"
        >
          {isSubmitting ? 'İŞLENİYOR...' : (task ? 'GÜNCELLE' : 'ATAMAYI TAMAMLA')}
        </button>
      </div>
    </form>
  );
};
