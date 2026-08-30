import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Task, User, TaskPrioritySchema } from '../types';
import { PRIORITY_LABELS, ROLE_LABELS } from '../constants';
import { cn } from '../lib/utils';
import { FileText, Target, Users, Calendar, AlertCircle } from 'lucide-react';
import { DatePicker } from './ui/DatePicker';
import { Button } from './ui/Button';
import { logger } from '../lib/logger';

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
  onSubmit: (taskData: Partial<Task>) => Promise<void> | void;
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

  const roleFilteredUsers = users.filter(u => allowedRoles.includes(u.role));
  // Düzenleme modunda, görevin MEVCUT sorumlusunun rolü düzenleyenin izinli-rol
  // listesinde olmayabilir (ör. bir Manager, bir Admin'e atanmış bir görevi
  // düzenlerken — Manager'ın izinli listesi Admin içermiyor). Eskiden bu
  // durumda mevcut sorumlu <select> seçeneklerinde hiç görünmüyordu; kullanıcı
  // yalnızca açıklama gibi ilgisiz bir alanı değiştirmek isterken bile
  // sorumluyu istemeden değiştirmiş oluyordu (bkz. kod denetimi). Mevcut
  // sorumlu, izinli listede yoksa da seçeneklere eklenir ve altında bir uyarı
  // gösterilir.
  const currentAssignee = task ? users.find(u => u.uid === task.assigneeId) : undefined;
  const currentAssigneeOutOfScope = Boolean(currentAssignee && !roleFilteredUsers.some(u => u.uid === currentAssignee.uid));
  const assignableUsers = currentAssigneeOutOfScope && currentAssignee
    ? [currentAssignee, ...roleFilteredUsers]
    : roleFilteredUsers;

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

      // onSubmit'in promise'i await edilir ki react-hook-form'un isSubmitting'i
      // gerçek Firestore round-trip'i süresince true kalsın — aksi halde
      // "ATAMAYI TAMAMLA" butonu network gecikmesi sırasında tekrar
      // tıklanabilir hale gelip aynı görevi iki kez oluşturabilirdi (bkz. kod
      // denetimi).
      await onSubmit(taskData);
    } catch (err) {
      logger.error('TaskFormModal submit error:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit(processForm)} className="flex flex-col gap-8 font-sans">
      <div className="flex flex-col gap-8">
        {/* Başlık */}
        <div className="flex flex-col gap-3">
          <label htmlFor="task-title-input" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
            <Target className="w-3.5 h-3.5 text-executive-gold stroke-[1.2]" />
            Operasyonel Hedef
          </label>
          <input
            id="task-title-input"
            type="text"
            placeholder="Talimat Başlığı"
            {...register('title')}
            className={cn(
              "text-[28px] font-light text-text-heading font-serif tracking-tight outline-none bg-field-surface placeholder:text-text-muted/30 w-full border-b border-text-muted/20 pb-3 transition-colors focus:border-executive-blue/50",
              errors.title && "border-status-danger/50 focus:border-status-danger/50"
            )}
          />
          {errors.title && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.title.message}</span>}
        </div>
        
        {/* Açıklama */}
        <div className="flex flex-col gap-3">
          <label htmlFor="task-description-textarea" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
            <FileText className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
            Kapsam & Detaylar
          </label>
          <textarea
            id="task-description-textarea"
            className={cn(
              "w-full min-h-[140px] resize-none bg-field-surface border border-executive-blue/[0.05] text-text-heading placeholder:text-text-muted/30 rounded-xl px-5 py-4 text-[14px] font-light leading-relaxed transition-all outline-none focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
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
             <label htmlFor="task-assignee-select" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
               <Users className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
               Sorumlu
             </label>
             {isSubTask && (
               <p className="text-[9px] text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
                 <AlertCircle className="w-3 h-3 flex-shrink-0" />
                 Alt talimatlar yalnızca memurlara atanabilir.
               </p>
             )}
             {currentAssigneeOutOfScope && (
               <p className="text-[9px] text-status-warning/80 px-1 tracking-wide flex items-center gap-1.5">
                 <AlertCircle className="w-3 h-3 flex-shrink-0" />
                 Mevcut sorumlu ({currentAssignee?.fullName}) sizin atayabileceğiniz rol dışında — değiştirmezseniz aynı kalır.
               </p>
             )}
             <select
              id="task-assignee-select"
              {...register('assigneeId')}
              className={cn(
                "w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.assigneeId && "border-status-danger/50"
              )}
            >
              <option value="" className="bg-surface-base text-text-heading">Sorumlu Seçiniz</option>
              {assignableUsers.map(m => (
                <option key={m.uid} value={m.uid} className="bg-surface-base text-text-heading">{m.fullName}</option>
              ))}
            </select>
            {errors.assigneeId && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.assigneeId.message}</span>}
          </div>

          <div className="flex flex-col gap-3">
             <label htmlFor="task-coordinator-select" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
               <Users className="w-3.5 h-3.5 text-text-muted/40 stroke-[1.2]" />
               İrtibatlı
             </label>
             <select
              id="task-coordinator-select"
              {...register('coordinatorId')}
              className={cn(
                "w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.coordinatorId && "border-status-danger/50"
              )}
            >
              <option value="" className="bg-surface-base text-text-heading">İrtibatlı Seçiniz (İsteğe Bağlı)</option>
              {coordinatorUsers.map(m => (
                <option key={m.uid} value={m.uid} className="bg-surface-base text-text-heading">{m.fullName} — {ROLE_LABELS[m.role]}</option>
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
             <label htmlFor="task-priority-select" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
               <AlertCircle className="w-3.5 h-3.5 text-executive-gold stroke-[1.2]" />
               Öncelik
             </label>
             <select
              id="task-priority-select"
              {...register('priority')}
              className="w-full bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 outline-none text-[13px] font-medium text-text-heading transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5"
            >
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-surface-base text-text-heading">{label}</option>
              ))}
            </select>
            {errors.priority && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.priority.message}</span>}
          </div>

          <div className="flex flex-col gap-3">
            <label htmlFor="task-deadline" className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 flex items-center gap-2.5">
              <Calendar className="w-3.5 h-3.5 text-executive-blue stroke-[1.2]" />
              SLA Mühleti
            </label>
            <DatePicker
              id="task-deadline"
              value={deadline}
              onChange={(v) => setValue('deadline', v, { shouldValidate: true, shouldDirty: true })}
              ariaLabel="SLA mühleti"
              icon={<Calendar className="w-3.5 h-3.5 text-executive-blue/60 stroke-[1.2] flex-shrink-0" aria-hidden="true" />}
              triggerClassName={cn(
                "w-full flex items-center gap-3 bg-field-surface border border-executive-blue/[0.05] rounded-xl px-4 py-3 text-[13px] transition-all focus:border-executive-blue/30 focus:ring-4 focus:ring-executive-blue/5",
                errors.deadline && "border-status-danger/50"
              )}
            />
            {errors.deadline && <span className="text-status-danger text-[10px] px-1 uppercase tracking-wider">{errors.deadline.message}</span>}
          </div>
        </div>
      </div>

      {/* Aksiyonlar */}
      <div className="flex justify-end gap-5 pt-10 border-t border-makam-border/5">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="px-10 h-14 font-normal"
        >
          İPTAL
        </Button>
        {/* Paylaşımlı Button'ın isLoading'i — eskiden gönderim sırasında etiket
            metni tamamen "İŞLENİYOR..." ile değiştiriliyordu; uygulamanın geri
            kalanı (TeamList/AuditLogList/BlockerList/TaskDetails/Settings/vb.)
            etiketi koruyup yanına dönen bir spinner ekleyen TEK bir kalıp
            kullanıyor (bkz. kod denetimi: iki farklı loading-state dili). */}
        <Button
          type="submit"
          isLoading={isSubmitting}
          className="px-12 h-14 font-semibold tracking-[0.16em]"
        >
          {task ? 'GÜNCELLE' : 'ATAMAYI TAMAMLA'}
        </Button>
      </div>
    </form>
  );
};
