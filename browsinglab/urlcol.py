from yarl import URL
from sqlobject.col import StringValidator, SOStringCol, StringCol

__all__ = ["URLCol"]

class URLValidator(StringValidator):

    def to_python(self, value, state):
        if value is None:
            return None
        return URL(value)

    def from_python(self, value, state):
        if value is None:
            return None
        return str(value)

class SOURLCol(SOStringCol):

    def createValidators(self):
        return [URLValidator(name=self.name)] + \
            super(SOURLCol, self).createValidators()

class URLCol(StringCol):
    baseClass = SOURLCol
