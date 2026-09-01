
import re

def check_tags(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    # Very simple tag matcher
    tags = re.findall(r'<(/?[a-zA-Z0-9]+)', content)
    stack = []
    
    # List of self-closing tags to ignore
    self_closing = {'img', 'br', 'hr', 'input', 'meta', 'link', 'Image', 'QuickActionCard', 'History', 'Search', 'Loader2', 'Plus', 'CheckCircle2', 'X', 'UserCheck', 'Siren', 'UserIcon', 'Home', 'Camera', 'LogIn', 'LogOut', 'LiveGuardMap'}
    
    for tag in tags:
        if tag in self_closing:
            continue
        if tag.startswith('/'):
            closing = tag[1:]
            if not stack:
                print(f"Extra closing tag </{closing}>")
            else:
                top = stack.pop()
                if top != closing:
                    print(f"Mismatch: <{top}> closed by </{closing}>")
        else:
            stack.append(tag)
    
    for tag in stack:
        print(f"Unclosed tag <{tag}>")

print("Checking src/app/admin/consolas/page.tsx")
check_tags('src/app/admin/consolas/page.tsx')
