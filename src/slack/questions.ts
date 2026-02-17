import type { SlackBot } from './bot'
import { addQuestion, getQuestion, listQuestions } from '../db/slack'
import type { SlackQuestion, CreateSlackQuestionInput } from '../types'

export type QuestionService = {
  ask: (input: CreateSlackQuestionInput) => Promise<SlackQuestion>
  get: (id: string) => SlackQuestion | null
  list: (options?: { status?: string; limit?: number; offset?: number }) => SlackQuestion[]
  waitForAnswer: (id: string, timeoutMs?: number) => Promise<SlackQuestion | null>
}

export function createQuestionService(bot: SlackBot): QuestionService {
  return {
    async ask(input: CreateSlackQuestionInput): Promise<SlackQuestion> {
      const question = addQuestion(input)
      const posted = await bot.postQuestion(question.id)
      return posted || question
    },

    get(id: string): SlackQuestion | null {
      return getQuestion(id)
    },

    list(options?: { status?: string; limit?: number; offset?: number }): SlackQuestion[] {
      return listQuestions(options)
    },

    async waitForAnswer(id: string, timeoutMs = 300000): Promise<SlackQuestion | null> {
      const pollInterval = 2000
      const deadline = Date.now() + timeoutMs

      while (Date.now() < deadline) {
        const q = getQuestion(id)
        if (!q) return null
        if (q.status === 'answered') return q
        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }

      return getQuestion(id)
    },
  }
}
