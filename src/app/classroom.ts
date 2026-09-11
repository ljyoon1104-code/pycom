export type ClassroomExample = {
  id: string;
  title: string;
  description: string;
  code: string;
};

export const CLASSROOM_EXAMPLES: readonly ClassroomExample[] = [
  {
    id: "output-calculation",
    title: "출력과 계산",
    description: "print()로 계산 결과를 출력합니다.",
    code: `price = 1500
count = 3

print("합계:", price * count)`,
  },
  {
    id: "input-condition",
    title: "input()과 조건문",
    description: "입력한 점수에 따라 결과를 구분합니다.",
    code: `name = input("이름: ")
score = int(input("점수: "))

if score >= 80:
    result = "통과"
else:
    result = "다시 도전"

print(f"{name}: {result}")`,
  },
  {
    id: "for-loop",
    title: "for 반복문",
    description: "반복하면서 수의 제곱을 출력합니다.",
    code: `for number in range(1, 6):
    print(number, number * number)`,
  },
  {
    id: "list-comprehension",
    title: "리스트와 리스트 내포",
    description: "조건에 맞는 값으로 새 리스트를 만듭니다.",
    code: `numbers = [number for number in range(10)]
evens = [number for number in numbers if number % 2 == 0]

print(evens)`,
  },
  {
    id: "function",
    title: "함수",
    description: "인수를 받아 값을 반환하는 함수를 만듭니다.",
    code: `def introduce(name, grade=1):
    return f"{grade}학년 {name}"

print(introduce("민수", 2))`,
  },
  {
    id: "class",
    title: "클래스",
    description: "객체에 값을 저장하고 메서드를 호출합니다.",
    code: `class Student:
    def __init__(self, name):
        self.name = name

    def show(self):
        print(f"학생: {self.name}")

student = Student("지수")
student.show()`,
  },
  {
    id: "file-io",
    title: "파일 쓰기와 읽기",
    description: "기기 안의 가상 파일에 글을 저장하고 읽습니다.",
    code: `with open("practice.txt", "w") as file:
    file.write("파일 연습 완료")

with open("practice.txt", "r") as file:
    print(file.read())`,
  },
  {
    id: "exception",
    title: "예외 처리",
    description: "예상할 수 있는 오류를 처리합니다.",
    code: `try:
    number = int("열")
except ValueError as error:
    print("숫자로 바꿀 수 없습니다.")

print("계속 실행합니다.")`,
  },
  {
    id: "random",
    title: "random",
    description: "시드를 지정해 같은 난수 결과를 만듭니다.",
    code: `import random

random.seed(10)
print(random.randint(1, 10))`,
  },
  {
    id: "datetime-date",
    title: "datetime.date",
    description: "오늘 날짜와 날짜의 각 부분을 확인합니다.",
    code: `import datetime

today = datetime.date.today()
print(today)
print(today.year, today.month, today.day)`,
  },
  {
    id: "turtle-shape",
    title: "turtle 도형",
    description: "교육용 거북이로 별 모양을 그립니다.",
    code: `import turtle

t = turtle.Turtle()
t.pencolor("blue")

for i in range(5):
    t.forward(100)
    t.right(144)

turtle.done()`,
  },
] as const;

export const WELCOME_SETTINGS_KEY = "python-learning-lab.settings.welcome-v1";

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const shouldShowWelcome = (storage: SettingsStorage): boolean => storage.getItem(WELCOME_SETTINGS_KEY) !== "hidden";

export const rememberWelcomeClosed = (storage: SettingsStorage, doNotShowAgain: boolean): void => {
  if (doNotShowAgain) storage.setItem(WELCOME_SETTINGS_KEY, "hidden");
};

export type UnsavedChoice = "save" | "discard" | "cancel";

export const mayReplaceDocument = (dirty: boolean, choice?: UnsavedChoice, saveSucceeded = true): boolean => {
  if (!dirty) return true;
  if (choice === "discard") return true;
  return choice === "save" && saveSucceeded;
};

export const exampleFileName = (title: string): string => `예제 - ${title}.py`;

export const exampleDocument = (example: ClassroomExample): { name: string; content: string; dirty: true } => ({
  name: exampleFileName(example.title),
  content: example.code,
  dirty: true,
});
