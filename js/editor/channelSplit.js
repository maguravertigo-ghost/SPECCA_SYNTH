const families=[
 ['Kick',[35,36]],['Snare / Clap',[37,38,39,40]],['Hi-hat',[42,44,46]],
 ['Toms',[41,43,45,47,48,50]],['Cymbals',[49,51,52,53,55,57,59]],
];
const names={35:'Acoustic Kick',36:'Kick',37:'Side Stick',38:'Snare',39:'Clap',40:'Electric Snare',42:'Closed Hi-hat',44:'Pedal Hi-hat',46:'Open Hi-hat',49:'Crash',51:'Ride',54:'Tambourine',56:'Cowbell'};
const tones=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export function splitGroups(patterns,{mode='families',isDrum=true}={}) {
    const pitches=[...new Set(patterns.flatMap(p=>p.notes.map(n=>n.key)))].sort((a,b)=>a-b);
    if(mode==='notes'||!isDrum)return pitches.map(key=>({name:isDrum?`${names[key]??'Drum'} (${key})`:`${tones[key%12]}${Math.floor(key/12)-1} (${key})`,keys:[key]}));
    const groups=families.map(([name,keys])=>({name,keys:keys.filter(k=>pitches.includes(k))})).filter(g=>g.keys.length);
    const known=new Set(families.flatMap(([,keys])=>keys));
    const other=pitches.filter(k=>!known.has(k));if(other.length)groups.push({name:'Percussion / Other',keys:other});
    return groups;
}
