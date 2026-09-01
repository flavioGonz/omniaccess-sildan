f="/opt/OmniAccess/src/components/ui/table.tsx"
s=open(f,encoding='utf-8').read()
s=s.replace("border border-neutral-800 bg-neutral-900 shadow","border border-border bg-card shadow")
s=s.replace('text-sm text-neutral-200","text-sm text-foreground"') if False else None
s=s.replace('caption-bottom text-sm text-neutral-200','caption-bottom text-sm text-foreground')
s=s.replace('font-semibold whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] text-neutral-300 uppercase',
            'font-semibold whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] uppercase')
open(f,'w',encoding='utf-8').write(s)
print("table fixed:", 'bg-neutral-900' not in s, 'text-neutral-200' not in s, 'text-neutral-300' not in s)
