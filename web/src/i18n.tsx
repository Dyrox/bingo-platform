import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

const strings = {
  zh: {
    site: 'Bingo 对战平台', platform: '对战平台', matches: '对局',
    recent: '最近对局', loadMore: '加载更多', loading: '加载中…', none: '还没有对局。用 bingo-reporter 打一局就会出现在这里。',
    error: '加载失败', notFound: '找不到这局对局', back: '← 所有对局',
    winner: '胜利', draw: '无人获胜', items: '物品', lines: '连线', cards: '卡',
    duration: '用时', uploadedBy: '上传者', mod: '模组版本', seed: '种子', card: '棋盘',
    cardOf: (teams: string) => `${teams} 的棋盘`, completedBy: '完成：', notCompleted: '无人完成',
    got: '已完成', missed: '未完成', alsoBy: '其他完成的队伍：', cards_: '棋盘',
    settings: '设置', games: '局数', wins: '胜场', recentOf: (n: number) => `最近 ${n} 局`,
    player: '玩家', vs: '对',
    opt: {
      winCondition: '胜利条件', endWhen: '结束条件', timeLimitSeconds: '时间限制', pvp: 'PvP', elytra: '鞘翅',
      nightVision: '夜视', keepInventory: '死亡不掉落', unlockRecipes: '解锁配方', playerKit: '玩家装备包', teamKit: '队伍装备包',
      spawnDimension: '出生维度', spawnDistance: '出生距离', stalemate: '僵局处理', goal: '获胜目标', mode: '模式',
    } as Record<string, string>,
    optValue: {
      cards: (n: number) => `完成 ${n} 张卡`, infinite: '无限', replace_goals: '替换目标',
      lines: (n: number) => `${n} 条线`, items: (n: number) => n >= 25 ? '全卡（25 个物品）' : `${n} 个物品`,
      lockout: '锁定模式', inventory: '背包模式', hidden_items: '隐藏物品',
      never: '不自动结束', first_win: '有队伍获胜即结束', teams_win: (n: number) => `${n} 队获胜后结束`, all_win: '所有队伍完成后结束',
      end_game: '结束对局', reroll_card: '重新抽卡', nothing: '不处理',
      'minecraft:overworld': '主世界', 'minecraft:the_nether': '下界', 'minecraft:the_end': '末地',
    } as Record<string, string | ((n: number) => string)>,
    me: '我的主页', allMatches: '全部对局', players: '玩家', home: '主页', records: '记录',
    homeLogin: '登录后查看你的主页', homeLoginHint: '用 Discord 登录，再在游戏里用 /bingo link 绑定你的角色，这里就会显示你的战绩。',
    homeLink: '绑定你的游戏角色', homeLinkHint: '已经登录了，还差一步：把你的 Minecraft 角色绑到这个账号上。',
    isMe: '我的主页', lastPlayed: '上次游玩', gamesCount: (n: number) => `${n} 局`,
    stat: { games: '总局数', record: '胜 / 负 / 平', winRate: '胜率', items: '获得物品', playtime: '游玩时长', streak: '连胜',
      best: '最高', bestItems: '单局最多物品', favTeam: '常用队伍', thisMonth: '本月' },
    activity: '游戏活动', itemsTrend: '每局物品数', noGames: '还没有对局。',
    dayGames: (n: number) => `${n} 局`, weekdays: ['', '一', '', '三', '', '五', ''],
    result: { win: '胜', loss: '负', draw: '平' } as Record<string, string>,
    timeline: '时间轴', noTimeline: '这局没有时间轴：它是旧版 bingo-reporter 上传的，新版会记录每个目标的完成时间。',
    ev: { got: '获得了', lost: '失去了', lines: (n: number) => `连成了第 ${n} 条线！`, card: (n: number) => n > 1 ? `完成了第 ${n} 张棋盘！` : '完成了棋盘！' },
    login: '登录', loginDiscord: '用 Discord 登录', logout: '退出登录', account: '账号', loginFailed: '登录没有成功，再试一次。',
    loginHint: '登录后可以把你的游戏角色绑到账号上，「我的主页」会自动认出你，上传密钥也在这里管理。',
    discordOff: '后端还没配置 Discord 登录：在 backend/.env 里填好 DISCORD_CLIENT_ID 和 DISCORD_CLIENT_SECRET（见 .env.example）。',
    myPlayers: '游戏角色', noPlayers: '还没有绑定游戏角色。', linkPlayer: '绑定游戏角色', unlink: '解除绑定',
    linkStep: '在装了 bingo-reporter 的游戏里输入：', linkWaiting: '等你在游戏里输入…', linkExpires: (m: number) => `${m} 分钟内有效`,
    linkDone: (n: string) => `已绑定 ${n}！`, copy: '复制', copied: '已复制',
    reporter: {
      title: 'Bingo Reporter 模组', download: '下载', needs: (mc: string, yab: string) => `需要 Minecraft ${mc} · Fabric · Yet Another Bingo ${yab}+`,
      what: '装在开房的那台电脑（开局域网的人，或者服务器）上，和 YAB 一起放进 mods。打完一局会自动上传到这里，也提供 /bingo link。',
      steps: ['把 jar 放进 .minecraft/mods（Modrinth：实例 → 内容 → 上传文件）', '启动一次游戏，会生成 config/bingo-reporter.json', '在下面生成上传密钥，填进那个文件的 "key"'],
      built: '构建于', allVersions: 'GitHub 上的所有版本', none: '这里还没有构建好的 jar（本地开发时用 reporter/ 里的 ./gradlew build）。',
    },
    keys: '上传密钥', keysHint: '每台跑 bingo-reporter 的电脑一个密钥，填进 .minecraft/config/bingo-reporter.json 的 "key"。',
    noKeys: '还没有密钥。', keyName: '电脑名字，比如 MacBook Air', createKey: '生成', revoke: '作废', lastUsed: '上次使用', never: '从未',
    keyOnce: '只显示这一次，现在就复制好：', created: '创建于',
    replay: { start: '回放这局', play: '播放', pause: '暂停', exit: '退出回放', label: '回放', speed: '倍速' },
    board: {
      nav: '排行榜', title: '排行榜', all: '总榜', month: '本月', player: '玩家', games: '局数', record: '胜 / 负 / 平', winRate: '胜率',
      items: '物品', streak: '最长连胜', line: '最快一条线', card: '最快一张卡', empty: '还没有对局。',
      timeHint: '游戏内时间，只统计有时间轴的对局（新版 reporter 上传的）。',
    },
    rivals: { title: '对手', none: '还没和别人对战过。', record: (w: number, l: number, d: number) => `${w} 胜 ${l} 负` + (d ? ` ${d} 平` : '') },
    myGoals: {
      title: '目标', best: '最擅长', worst: '最头疼', none: '打几局之后这里会出现你的强项和弱项。',
      done: (c: number, a: number) => `完成 ${c}/${a}`, missed: (m: number, a: number) => `错过 ${m}/${a}`, avg: '平均',
    },
    goalStat: (a: number, rate: number, avg: string | null) => `出现 ${a} 次 · 完成 ${rate}%` + (avg ? ` · 平均 ${avg}` : ''),
    imported: '导入', importedTip: '从 YAB 的 bingo.db 导入：只有结果，没有棋盘和时间轴',
    importedNote: '这局是从 YAB 自己的记录（bingo.db）导入的：只有胜负、物品数和设置，没有棋盘、回放和时间轴。',
    importedNoteLogs: '这局是从 YAB 自己的记录（bingo.db）导入的，时间轴是从服务器日志补回的：知道谁几点拿到了哪个目标，但不知道整张棋盘，所以没有棋盘和回放。',
    partialNote: '这份记录只包含上传者那一队，其他队伍和玩家不在里面。',
    yabImport: {
      title: '导入 YAB 历史记录',
      what: 'YAB 会把每局结果存在开房那台电脑（或服务器）上。导入后，你以前的胜负、物品数和游戏时长都会算进统计；没有棋盘和时间轴。已经有的对局会跳过，重复导入也没关系。',
      where: '文件位置：.minecraft/config/yet-another-minecraft-bingo/bingo.db（Modrinth：实例 → 打开文件夹 → config；老版本叫 stats.db）',
      server: '在别人服务器上玩的局，你电脑上只记了你自己那一队。找服务器主人要他那份 bingo.db 导入，就有所有队伍和玩家了。',
      choose: '① 选择 bingo.db', uploading: '导入中…', go: '导入',
      logsHint: '可选：如果有服务器的 logs 文件夹（latest.log 和 *.log.gz），一起选上，能补回这些对局的时间轴：谁几点拿到了哪个目标、几点连成线。',
      chooseLogsFolder: '② 选择 logs 文件夹（可选）', chooseLogFiles: '或选日志文件', logsChosen: (n: number) => `${n} 个日志文件`,
      result: (r: { found: number; imported: number; replaced: number; skipped: number; partial: number; timelines: number }) =>
        `文件里有 ${r.found} 局：新导入 ${r.imported} 局` + (r.replaced ? `，补全 ${r.replaced} 局` : '') + (r.skipped ? `，已存在跳过 ${r.skipped} 局` : '') + (r.partial ? `（其中 ${r.partial} 局只有部分玩家）` : '') + (r.timelines ? `；从日志补回 ${r.timelines} 局的时间轴` : '') + '。',
      errors: { not_sqlite: '这不是 SQLite 文件。', not_yab: '这个文件里没有 YAB 的对局表，是不是选错文件了？', file_too_large: '文件太大了（上限 50 MB）。', no_file: '没有选文件。', not_logged_in: '请先登录。' } as Record<string, string>,
    },
    excludedTag: '不计入统计',
    manage: {
      title: '管理这局', exclude: '不计入统计', excludeHint: '对局照样能看，但不算进胜负、时长、排行榜、对手记录和目标统计。',
      delete: '删除这局', confirm: '确定删除这局吗？棋盘、时间轴都会一起删除，不能恢复。', who: '只有上传这局的人和管理员能看到这里。',
    },
    pickMatch: '选一局查看详情', openFull: '打开完整页面', vsLabel: '对手',
    guide: {
      nav: '难度图鉴', title: 'Bingo 难度图鉴',
      sortLabel: '排序', sort: { default: '默认顺序', seen: '出现最多', rate: '完成率最高', fast: '平均最快' } as Record<string, string>,
      sub: 'Yet Another Minecraft Bingo 2.15.1（MC 26.3）里所有 S / A / B / C / D 级目标：物品、进度和挑战。★ 表示不是物品的目标（进度或挑战）。',
      all: '全部', star: '★ 仅非物品', item: '物品', advancement: '进度', challenge: '挑战',
      bAll: '全部棋盘', bNormal: '普通物品', bSimple: '简化棋盘',
      bTip: { all: '两种物品棋盘的目标都显示', normal: '普通物品棋盘：约 1,500 个物品，每种单独一格', simplified: '简化棋盘：458 个目标，颜色、木头等变种合并成“任意 X”，难度按简化棋盘的表' } as Record<string, string>,
      was: (t: string) => `普通棋盘为 ${t}`, search: '搜索名称、描述或 ID…',
      sum: (n: number, st: number) => `${n} 个 · ★ ${st}`, meta: (n: number, st: number) => `${n} 个目标 · ★ ${st}`,
      count: (n: number, all: number) => `显示 ${n} / ${all}`, empty: '没有符合条件的目标。试试清空搜索或打开更多难度。',
      advLabel: '★ 进度', chLabel: '★ 挑战', itemLabel: '物品', sm: '仅简化棋盘', smTip: '只在“简化棋盘”里出现',
      grp: (n: number) => `${n} 选 1`, grpTip: '一张卡上最多出现其中一个：',
      adv: { story: 'Minecraft', adventure: '冒险', husbandry: '农牧业', nether: '下界', end: '末地' } as Record<string, string>,
      kind: { collect: '收集', never: '禁止', stat: '统计', all: '全套', any: '任意' } as Record<string, string>,
      catTag: { advancement: '进度', challenge: '挑战' } as Record<string, string>,
      footer: '数据取自模组 jar 内的难度表（items / advancements / challenge，以及 simplified 里的“任意 X”目标）和原版 26.3 语言文件。挑战里的数量区间是随机范围，开局时会抽一个具体值。“N 选 1”表示这些目标互斥，一张卡上最多出现其中一个。',
    },
    yes: '开', no: '关',
  },
  en: {
    site: 'Bingo Platform', platform: 'Platform', matches: 'Matches',
    recent: 'Recent matches', loadMore: 'Load more', loading: 'Loading…', none: 'No matches yet. Play a round with bingo-reporter installed and it shows up here.',
    error: 'Couldn’t load', notFound: 'Match not found', back: '← All matches',
    winner: 'Winner', draw: 'No winner', items: 'items', lines: 'lines', cards: 'cards',
    duration: 'Duration', uploadedBy: 'Uploaded by', mod: 'Mod version', seed: 'Seed', card: 'Card',
    cardOf: (teams: string) => `${teams}’s card`, completedBy: 'Completed by ', notCompleted: 'Not completed',
    got: 'Completed', missed: 'Not completed', alsoBy: 'Also completed by ', cards_: 'Cards',
    settings: 'Settings', games: 'Games', wins: 'Wins', recentOf: (n: number) => n === 1 ? 'Last game' : `Last ${n} games`,
    player: 'Player', vs: 'vs',
    opt: {
      winCondition: 'Win condition', endWhen: 'Ends when', timeLimitSeconds: 'Time limit', pvp: 'PvP', elytra: 'Elytra',
      nightVision: 'Night vision', keepInventory: 'Keep inventory', unlockRecipes: 'Unlock recipes', playerKit: 'Player kit', teamKit: 'Team kit',
      spawnDimension: 'Spawn dimension', spawnDistance: 'Spawn distance', stalemate: 'Stalemate', goal: 'Goal', mode: 'Mode',
    } as Record<string, string>,
    optValue: {
      cards: (n: number) => `${n} card${n === 1 ? '' : 's'}`, infinite: 'Infinite', replace_goals: 'Replace goals',
      lines: (n: number) => `${n} line${n === 1 ? '' : 's'}`, items: (n: number) => n >= 25 ? 'Full card (25 items)' : `${n} items`,
      lockout: 'Lockout', inventory: 'Inventory', hidden_items: 'Hidden items',
      never: 'Never', first_win: 'First team wins', teams_win: (n: number) => `${n} teams win`, all_win: 'All teams finish',
      end_game: 'End the game', reroll_card: 'Reroll the card', nothing: 'Nothing',
      'minecraft:overworld': 'Overworld', 'minecraft:the_nether': 'Nether', 'minecraft:the_end': 'The End',
    } as Record<string, string | ((n: number) => string)>,
    me: 'My page', allMatches: 'All matches', players: 'Players', home: 'Home', records: 'Records',
    homeLogin: 'Log in to see your page', homeLoginHint: 'Log in with Discord, then link your character in game with /bingo link, and your stats show up here.',
    homeLink: 'Link your Minecraft character', homeLinkHint: 'You’re logged in; one step left: link your Minecraft character to this account.',
    isMe: 'My page', lastPlayed: 'Last played', gamesCount: (n: number) => `${n} game${n === 1 ? '' : 's'}`,
    stat: { games: 'Games', record: 'W / L / D', winRate: 'Win rate', items: 'Items', playtime: 'Playtime', streak: 'Win streak',
      best: 'best', bestItems: 'Most items in a game', favTeam: 'Favourite team', thisMonth: 'This month' },
    activity: 'Activity', itemsTrend: 'Items per game', noGames: 'No games yet.',
    dayGames: (n: number) => `${n} game${n === 1 ? '' : 's'}`, weekdays: ['', 'Mon', '', 'Wed', '', 'Fri', ''],
    result: { win: 'W', loss: 'L', draw: 'D' } as Record<string, string>,
    timeline: 'Timeline', noTimeline: 'No timeline for this round: it was uploaded by an older bingo-reporter. Newer versions record when every goal was reached.',
    ev: { got: 'got', lost: 'lost', lines: (n: number) => `scored ${n} line${n === 1 ? '' : 's'}!`, card: (n: number) => n > 1 ? `completed card ${n}!` : 'completed their card!' },
    login: 'Log in', loginDiscord: 'Log in with Discord', logout: 'Log out', account: 'Account', loginFailed: 'Login didn’t work, try again.',
    loginHint: 'Log in to link your Minecraft character, so “My page” knows who you are, and to manage upload keys.',
    discordOff: 'Discord login isn’t set up on the backend yet: fill in DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in backend/.env (see .env.example).',
    myPlayers: 'Minecraft characters', noPlayers: 'No character linked yet.', linkPlayer: 'Link a character', unlink: 'Unlink',
    linkStep: 'In a game running bingo-reporter, type:', linkWaiting: 'Waiting for you to type it in game…', linkExpires: (m: number) => `valid for ${m} minutes`,
    linkDone: (n: string) => `Linked ${n}!`, copy: 'Copy', copied: 'Copied',
    reporter: {
      title: 'Bingo Reporter mod', download: 'Download', needs: (mc: string, yab: string) => `Needs Minecraft ${mc} · Fabric · Yet Another Bingo ${yab}+`,
      what: 'Install it on the computer that hosts the game (whoever opens to LAN, or the server), next to YAB in mods. Finished rounds upload here automatically, and it adds /bingo link.',
      steps: ['Put the jar in .minecraft/mods (Modrinth: instance → Content → Upload files)', 'Start the game once; it creates config/bingo-reporter.json', 'Create an upload key below and put it in that file’s "key"'],
      built: 'Built', allVersions: 'All versions on GitHub', none: 'No built jar here yet (in local development, build it with ./gradlew build in reporter/).',
    },
    keys: 'Upload keys', keysHint: 'One key per computer that runs bingo-reporter; put it in "key" in .minecraft/config/bingo-reporter.json.',
    noKeys: 'No keys yet.', keyName: 'Computer name, e.g. MacBook Air', createKey: 'Create', revoke: 'Revoke', lastUsed: 'Last used', never: 'never',
    keyOnce: 'Shown only this once, copy it now:', created: 'Created',
    replay: { start: 'Replay this round', play: 'Play', pause: 'Pause', exit: 'Exit replay', label: 'Replay', speed: 'Speed' },
    board: {
      nav: 'Leaderboard', title: 'Leaderboard', all: 'All time', month: 'This month', player: 'Player', games: 'Games', record: 'W / L / D', winRate: 'Win rate',
      items: 'Items', streak: 'Best streak', line: 'Fastest line', card: 'Fastest card', empty: 'No matches yet.',
      timeHint: 'In-game time, from rounds that have a timeline (uploaded by a recent reporter).',
    },
    rivals: { title: 'Opponents', none: 'Hasn’t played against anyone yet.', record: (w: number, l: number, d: number) => `${w}W ${l}L` + (d ? ` ${d}D` : '') },
    myGoals: {
      title: 'Goals', best: 'Strongest', worst: 'Toughest', none: 'After a few rounds your strong and weak goals show up here.',
      done: (c: number, a: number) => `done ${c}/${a}`, missed: (m: number, a: number) => `missed ${m}/${a}`, avg: 'avg',
    },
    goalStat: (a: number, rate: number, avg: string | null) => `seen ${a}× · ${rate}% done` + (avg ? ` · avg ${avg}` : ''),
    imported: 'Imported', importedTip: 'Imported from YAB’s bingo.db: results only, no card or timeline',
    importedNote: 'This round was imported from YAB’s own records (bingo.db): results, items and settings only, no card, replay or timeline.',
    importedNoteLogs: 'This round was imported from YAB’s own records (bingo.db), with the timeline rebuilt from the server’s logs: who got which goal when is known, but not the whole card, so there’s no card or replay.',
    partialNote: 'This record only has the uploader’s own team; the other teams and players aren’t in it.',
    yabImport: {
      title: 'Import YAB history',
      what: 'YAB saves every round on the computer (or server) that hosted it. Import it and your past wins, items and playtime count towards your stats; there are no cards or timelines. Rounds already here are skipped, so importing twice is fine.',
      where: 'File: .minecraft/config/yet-another-minecraft-bingo/bingo.db (Modrinth: instance → open folder → config; older versions call it stats.db)',
      server: 'Rounds on someone else’s server are only recorded for your own team on your computer. Ask the server owner for their bingo.db to get every team and player.',
      choose: '① Choose bingo.db', uploading: 'Importing…', go: 'Import',
      logsHint: 'Optional: if you have the server’s logs folder (latest.log and *.log.gz), add it to bring back these rounds’ timelines: who got which goal when, and when lines were made.',
      chooseLogsFolder: '② Choose the logs folder (optional)', chooseLogFiles: 'or pick log files', logsChosen: (n: number) => `${n} log files`,
      result: (r: { found: number; imported: number; replaced: number; skipped: number; partial: number; timelines: number }) =>
        `${r.found} rounds in the file: ${r.imported} imported` + (r.replaced ? `, ${r.replaced} completed` : '') + (r.skipped ? `, ${r.skipped} already here` : '') + (r.partial ? ` (${r.partial} with only some players)` : '') + (r.timelines ? `; timelines for ${r.timelines} from the logs` : '') + '.',
      errors: { not_sqlite: 'That isn’t an SQLite file.', not_yab: 'That file has no YAB match tables. Wrong file?', file_too_large: 'File too large (50 MB max).', no_file: 'No file chosen.', not_logged_in: 'Log in first.' } as Record<string, string>,
    },
    excludedTag: 'Doesn’t count',
    manage: {
      title: 'Manage this round', exclude: 'Doesn’t count', excludeHint: 'Still visible, but left out of records, playtime, the leaderboard, opponents and goal stats.',
      delete: 'Delete this round', confirm: 'Delete this round? Its card and timeline go too, and it can’t be undone.', who: 'Only the uploader and admins see this.',
    },
    pickMatch: 'Pick a match to see it here', openFull: 'Open full page', vsLabel: 'vs',
    guide: {
      nav: 'Tier guide', title: 'Bingo Tier Guide',
      sortLabel: 'Sort', sort: { default: 'Default order', seen: 'Most seen', rate: 'Highest completion', fast: 'Fastest on average' } as Record<string, string>,
      sub: 'Every S / A / B / C / D goal in Yet Another Minecraft Bingo 2.15.1 (MC 26.3): items, advancements and challenges. ★ marks goals that aren’t items (advancements or challenges).',
      all: 'All', star: '★ Non-items', item: 'Items', advancement: 'Advancements', challenge: 'Challenges',
      bAll: 'All boards', bNormal: 'Normal items', bSimple: 'Simplified',
      bTip: { all: 'Show goals from both item boards', normal: 'Normal item board: ~1,500 items, each its own goal', simplified: 'Simplified board: 458 goals; colour, wood and other variants merged into “Any X”, with that board’s tiers' } as Record<string, string>,
      was: (t: string) => `${t} on the normal board`, search: 'Search name, description or ID…',
      sum: (n: number, st: number) => `${n} · ★ ${st}`, meta: (n: number, st: number) => `${n} goals · ★ ${st}`,
      count: (n: number, all: number) => `Showing ${n} / ${all}`, empty: 'No goals match. Try clearing the search or turning on more tiers.',
      advLabel: '★ Advancements', chLabel: '★ Challenges', itemLabel: 'Items', sm: 'Simplified only', smTip: 'Only appears on the Simplified card list',
      grp: (n: number) => `1 of ${n}`, grpTip: 'At most one of these per card:',
      adv: { story: 'Minecraft', adventure: 'Adventure', husbandry: 'Husbandry', nether: 'Nether', end: 'The End' } as Record<string, string>,
      kind: { collect: 'Collect', never: 'Never', stat: 'Stat', all: 'All of', any: 'Any of' } as Record<string, string>,
      catTag: { advancement: 'Advancement', challenge: 'Challenge' } as Record<string, string>,
      footer: 'Data comes from the tier lists inside the mod jar (items / advancements / challenge, plus the “Any X” goals from simplified) and the vanilla 26.3 language files. Challenge amounts shown as ranges are rolled when the game starts. “1 of N” means those goals are mutually exclusive: at most one of them appears on a card.',
    },
    yes: 'On', no: 'Off',
  },
};

export type Strings = typeof strings.zh;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: Strings }>(null!);

const readLang = (): Lang => {
  try { return localStorage.getItem('bingo-lang') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
};

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readLang);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try { localStorage.setItem('bingo-lang', lang); } catch { /* private mode */ }
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t: strings[lang] as Strings }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);

/** English labels are plural ("items"); drop the s for exactly one. */
export const plural = (n: number, word: string, lang: Lang) => (lang === 'en' && n === 1 ? word.replace(/s$/, '') : word);
