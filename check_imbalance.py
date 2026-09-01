
def check_imbalance(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    stack = []
    line_num = 1
    col_num = 1
    
    for i, char in enumerate(content):
        if char == '\n':
            line_num += 1
            col_num = 1
            continue
        
        if char == '{':
            stack.append(('{', line_num, col_num))
        elif char == '}':
            if not stack or stack[-1][0] != '{':
                print(f"Extra closing brace at line {line_num}, col {col_num}")
            else:
                stack.pop()
        elif char == '(':
            stack.append(('(', line_num, col_num))
        elif char == ')':
            if not stack or stack[-1][0] != '(':
                print(f"Extra closing paren at line {line_num}, col {col_num}")
            else:
                stack.pop()
        
        col_num += 1
    
    for item, l, c in stack:
        print(f"Unclosed {item} from line {l}, col {c}")

print("Checking src/app/guard/GuardConsole.tsx")
check_imbalance('src/app/guard/GuardConsole.tsx')
print("\nChecking src/app/admin/consolas/page.tsx")
check_imbalance('src/app/admin/consolas/page.tsx')
