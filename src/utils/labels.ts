import type { AccessStatus, FeedbackMethod, InputType, LifecycleEventType, PracticeFormat, TargetUser, UseScenario } from '../types'

export const targetUserLabels: Record<TargetUser, string> = {
  primary_students: '小学生', secondary_students: '中学生', university_students: '大学生', language_learners: '语言学习者', professional_exam_candidates: '职业考试备考者', teachers: '教师', enterprise_learners: '企业学习者', other: '其他',
}
export const scenarioLabels: Record<UseScenario, string> = {
  question_generation: '生成题目', daily_practice: '日常刷题', mock_exam: '模拟考试', vocabulary_memory: '词汇记忆', speaking_mock_exam: '口语模考', dictation_training: '听写训练', mistake_review: '错题复习', knowledge_reinforcement: '知识巩固',
}
export const inputTypeLabels: Record<InputType, string> = {
  pdf: 'PDF', word: 'Word', ppt: 'PPT', image: '图片', webpage: '网页', plain_text: '纯文本', audio: '音频', video: '视频', preset_question_bank: '预设题库', manual_entry: '手动输入',
}
export const practiceFormatLabels: Record<PracticeFormat, string> = {
  single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', short_answer: '简答题', flashcard: '闪卡', dictation: '听写', spoken_response: '口语作答', full_mock_exam: '整套模考',
}
export const feedbackMethodLabels: Record<FeedbackMethod, string> = {
  correctness: '对错反馈', answer_explanation: '答案解析', knowledge_explanation: '知识点解释', ai_follow_up: 'AI 追问', scoring: '评分', mistake_book: '错题本', learning_suggestion: '学习建议',
}
export const accessStatusText: Record<AccessStatus, string> = {
  normal: '正常可访问', login_required: '需要登录', pending_recheck: '等待复检', partial_abnormal: '部分异常', link_unavailable: '链接不可用', suspected_migration: '疑似迁移', paused: '已暂停', ended: '已结束', recovered: '已恢复', unknown: '未知',
}
export const lifecycleEventLabels: Record<LifecycleEventType, string> = {
  first_seen: '首次发现', first_published: '首次发布', version_updated: '版本更新', domain_migrated: '地址迁移', product_pivoted: '方向调整', link_abnormal: '链接异常', recovered: '恢复访问', paused: '作者声明暂停', ended: '作者声明结束', asset_added: '新增资产', reused_by_project: '被其他作品复用',
}
