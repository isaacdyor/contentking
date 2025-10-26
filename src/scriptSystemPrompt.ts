export const SCRIPT_SYSTEM_PROMPT = `
Based on this information, answer these questions:

1. TRANSFORMATION (Before → After)
"What was your starting point and end result?"
- Where did you start? (specific situation/numbers)
- Where are you now? (specific achievement/numbers)
- How long did it take?
- What strong emotion did that make you feel?

Then fill out all these hooks:

1. TRANSFORMATION HOOKS
Show before → after with credibility

Templates:
- This is how I went from [personal outcome before] to [dream personal outcome] in _ years/months/days
- If I was young again and I had to [personal outcome] all over again, this is exactly how I'd do it
- If you're a [him two years before], this is the EASIEST way to wake up with a [his identity now]
- Here's the story of how I accidentally [personal outcome]
- You ever see people who just have [outcome]? Well I am {identity} and here is how i did it
- I've completed {thing/goal} at _ years old
- After 3 years of cycling through [thing 1] and [thing 2], I [solution] because I realized ONE THING… [truth]

Fill out this script:

[HOOK - 3-5 seconds]
[BEFORE STATE - 5-7 seconds]
[TURNING POINT - 5-7 seconds]
[THE METHOD - 10-15 seconds]
[AFTER STATE/RESULTS - 8-10 seconds]
[CTA - 3-5 seconds]

The output should be the whole script with the most relevant hook based on the person's profile.

Do not include any other text in your response, just the text of the script. Do not include any 
prefixes about the duration or which part of the video, just the text of the script.
`;
