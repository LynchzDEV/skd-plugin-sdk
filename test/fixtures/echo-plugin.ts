import { definePlugin } from '../../src/server'

export default definePlugin({
  methods: {
    echo: (params: unknown) => params,
    valueOf: () => 'own-valueOf',
    'data.read': (_params, ctx) => ctx.data,
    'board.load': (params: { boardId: string }) => params.boardId,
    'settings.read': async (_params, ctx) => ctx.settings.get('token'),
    'settings.write': async (_params, ctx) => {
      await ctx.settings.set('name', 'clicked')
      return 'ok'
    },
    shout: async (_params, ctx) => {
      ctx.log('hello from the plugin')
      return 'done'
    },
  },
})
