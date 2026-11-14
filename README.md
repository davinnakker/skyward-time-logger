# Overview

Since I want the skills of a full-stack software developer, part of those skills will be working in the browser. Now most of the time I will be writing HTML, CSS and Javascript that will run in the browser but you can also use Javascript to manipulate web pages you use daily. This script is to help me with a real world problem I have been expierencing. I have to put in my hours manually at the job I work. The webpage that we use is older and takes a lot of manual clicks to put in your time. I decided to make an automation by using a tool called TamperMonkey. It allows you to make your own scripts that you can inject into the webpage and automate tasks.

This software will activate when you go to the URL that identifies the time logger on the skyward system. Once at that URL you will see a box pop up in the top right corner. It will allow you to put in the times you want once and then press 'Fill Day'. This button will then log you time for that day. You may then proceed to the next day and you preset times will not change, allowing you do go day by day and put in the same hours with only one click. 

My purpose in writing this was not only to allow me to go faster but also allow others at my place of employment the same automation so that they can spend less time logging their hours and not have to set aside a longer portion of time to do so.

[Demo Video](https://youtu.be/8Eqrr98-6Uk)

# Development Environment

Tools:
TamperMonkey Chrome Extension

Languages:
Javascript

# Useful Websites

- [Tamper Monkey Reference](https://www.tampermonkey.net/)
- [Eloquent Javascript](https://eloquentjavascript.net/index.html)

# Future Work

- Add Ability to just do less or more than the hardcoded two shifts per day
- Feature to input a date range and fill a week with one click

# Setup

1. Install TamperMonkey
2. Go to Manage Extensions
3. Click TamperMonkey Extension
4. Enable 'Allow Usercripts'
5. Go to Dashboard
6. Go to the Utilities Tab
7. Go down to Import from URL
8. Use https://davinnakker.github.io/skyward-time-logger/final.js and Press Install
9. Press Install
10. Make sure TamperMonkey is Enabled
11. Go to you Time Tracking page
12. Select hours and press Fill Time
