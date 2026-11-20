// Pick a specific reaction. Hazards take priority over celebrations.
export function reaction(plan, { streak = 0, score = 0, target = 1, moves = 0 } = {}) {
  if (plan.negative) return { title: 'STOLEN!', icon: '−', big: true };
  if (plan.bonusMoves) return { title: '+1 MOVE!', icon: '↻', big: true };
  if (plan.thaw) return { title: 'THAWED!', icon: '❄', big: true };
  if (plan.double && plan.points > 0) return { title: 'DOUBLE WIN!', icon: '×2', big: true };
  if (plan.ids.length >= 10) return { title: 'MEGA CHAIN!', icon: '✦', big: true };
  if (plan.ids.length >= 6) return { title: 'BIG CHAIN!', icon: '✦', big: true };
  if (streak >= 3 && streak % 3 === 0) return { title: 'HOT STREAK!', icon: '♠', big: true };
  if (score > 0 && score < target && score >= target * .9) return { title: 'SO CLOSE!', icon: '♠', big: true };
  if (moves === 1) return { title: 'LAST MOVE', icon: '!', big: true };
  if (plan.blocked.length) return { title: 'ICE BLOCKED!', icon: '❄', big: false };
  return { title: plan.points > 0 ? 'NICE FLIP!' : 'CHAIN CLEARED', icon: '+', big: false };
}
