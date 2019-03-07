#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""The setup script."""

from setuptools import setup, find_packages

requirements = [
    "lxml",
    "cssselect",
    "nltk",
    "sumy",
    "feedparser",
    "click",
    "sqlobject",
    "colorama",
    "yarl",
]

setup(
    name='browsinglab',
    version='0.1.0',
    description="Generate and access data about browsing history",
    # long_description=readme + '\n\n' + history,
    author="Ian Bicking",
    author_email='ian@ianbicking.org',
    url='https://github.com/ianb/personal-history-archive',
    packages=find_packages(include=['browsinglab']),
    include_package_data=True,
    install_requires=requirements,
    license="MIT license",
    zip_safe=True,
    # keywords='',
    classifiers=[
        'Development Status :: 2 - Pre-Alpha',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',
        'Natural Language :: English',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.3',
        'Programming Language :: Python :: 3.4',
        'Programming Language :: Python :: 3.5',
    ],
    entry_points='''
        [console_scripts]
        blab=browsinglab.cli:cli
        browser-connector=browsinglab.connector:connect
    ''',
    # test_suite='tests',
    # tests_require=test_requirements,
    # setup_requires=setup_requirements,
)
